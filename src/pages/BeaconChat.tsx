import { useState, useEffect, useRef, useCallback } from "react";
import { useWallet } from "@txnlab/use-wallet-react";
import algosdk from "algosdk";
import { Peer, type DataConnection } from "peerjs";
import nacl from "tweetnacl";

import { toast } from "react-toastify";
import {
  MdPerson,
  MdClose,
  MdAttachFile,
  MdPersonAdd,
  MdBlock,
  MdRefresh,
  MdSend,
  MdSignalWifiOff,
  MdSignalWifi4Bar,
} from "react-icons/md";
import {
  uint8ToBase64,
  base64ToUint8,
  deriveKeyFromSignature,
} from "../utils/deadDropCrypto";
import { getNfdDomain } from "../utils";

// ═══════════════════════════════════════════════════════════════════
//  BEACON Protocol Constants
// ═══════════════════════════════════════════════════════════════════

const BEACON_PREFIX = "BEACON/1:";
const BEACON_PREFIX_B64 = btoa(BEACON_PREFIX);
const BEACON_PROTOCOL_ADDRESS =
  "BEACDGTII2LVPBDX47D64RVYFDIFROF5POBJS6ZYD6UZISP6RRHRLUSY64"; // Actual
const MAINNET_ALGONODE_INDEXER = "https://mainnet-idx.algonode.cloud";
const BEACON_GENESIS_HASH_MAINNET =
  "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
const BEACON_DOMAIN_NOTE = "BEACON/1:derive-encryption-key";

const POLL_INTERVAL_ACTIVE = 5_000;
const OFFER_EXPIRY_MS = 5 * 60 * 1000; // 5 min for live offers
const BOND_REQUEST_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for bond requests

// ═══════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════

interface ChatMessage {
  text: string;
  sender: "me" | "peer";
  timestamp: number;
  type: "text" | "file-meta" | "file-chunk" | "file-complete";
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  fileId?: string;
  fileUrl?: string;
}

interface BeaconNote {
  proto: string;
  type:
    | "announce"
    | "offer"
    | "answer"
    | "bond-request"
    | "bond-accept"
    | "ping"
    | "revoke";
  wpk: string;
  ts: number;
  exp?: number;
  bondFee?: number;
  nfd?: string;
}

interface EncryptedEnvelope {
  epk: string;
  nonce: string;
  ct: string;
}

interface Contact {
  address: string;
  wpk: string;
  nfd?: string;
  addedAt: number;
  lastSeen?: number;
}

interface BondRequest {
  fromAddress: string;
  wpk: string;
  nfd?: string;
  ts: number;
  round: number;
}

type Phase =
  | "home"
  | "contacts"
  | "bond-requests"
  | "waiting"
  | "connecting"
  | "chat";

// ═══════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

function deriveSessionToken(
  sharedSecret: Uint8Array,
  timestamp: number
): string {
  const tsBytes = new TextEncoder().encode(String(timestamp));
  const hash = nacl.hash(concatBytes(sharedSecret, tsBytes)).slice(0, 16);
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function encryptBeaconNote(
  payload: BeaconNote,
  recipientWpk: Uint8Array
): string {
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  const ciphertext = nacl.box(plaintext, nonce, recipientWpk, ephemeral.secretKey);
  const envelope: EncryptedEnvelope = {
    epk: uint8ToBase64(ephemeral.publicKey),
    nonce: uint8ToBase64(nonce),
    ct: uint8ToBase64(ciphertext),
  };
  return `${BEACON_PREFIX}${btoa(JSON.stringify(envelope))}`;
}

function decryptBeaconNote(
  noteStr: string,
  mySecretKey: Uint8Array
): BeaconNote | null {
  try {
    if (!noteStr.startsWith(BEACON_PREFIX)) return null;
    const envelopeJson = atob(noteStr.slice(BEACON_PREFIX.length));
    const envelope: EncryptedEnvelope = JSON.parse(envelopeJson);
    const epk = base64ToUint8(envelope.epk);
    const nonce = base64ToUint8(envelope.nonce);
    const ct = base64ToUint8(envelope.ct);
    const decrypted = nacl.box.open(ct, nonce, epk, mySecretKey);
    if (!decrypted) return null;
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch {
    return null;
  }
}

function parsePlaintextBeaconNote(noteStr: string): BeaconNote | null {
  try {
    if (!noteStr.startsWith(BEACON_PREFIX)) return null;
    const json = atob(noteStr.slice(BEACON_PREFIX.length));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function shortenAddr(addr: string): string {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getBlockedWpks(): string[] {
  try {
    return JSON.parse(localStorage.getItem("beacon_blocked") || "[]");
  } catch {
    return [];
  }
}

function setBlockedWpks(wpks: string[]) {
  localStorage.setItem("beacon_blocked", JSON.stringify(wpks));
}

function getContacts(address: string): Contact[] {
  try {
    return JSON.parse(
      localStorage.getItem(`beacon_contacts_${address}`) || "[]"
    );
  } catch {
    return [];
  }
}

function saveContacts(address: string, contacts: Contact[]) {
  localStorage.setItem(
    `beacon_contacts_${address}`,
    JSON.stringify(contacts)
  );
}


function setLastSeenRound(address: string, round: number) {
  localStorage.setItem(`beacon_last_round_${address}`, String(round));
}

function getChatHistory(myAddr: string, peerAddr: string): ChatMessage[] {
  try {
    const key = `beacon_chat_${[myAddr, peerAddr].sort().join(":")}`;
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
}

function saveChatHistory(
  myAddr: string,
  peerAddr: string,
  messages: ChatMessage[]
) {
  const key = `beacon_chat_${[myAddr, peerAddr].sort().join(":")}`;
  // Keep last 500 messages
  const trimmed = messages.slice(-500);
  localStorage.setItem(key, JSON.stringify(trimmed));
}

// ═══════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════

export function BeaconChat() {
  const { activeAddress, algodClient, signTransactions } = useWallet();

  // ── Phase & UI State ──
  const [phase, setPhase] = useState<Phase>("home");
  const [connectionStatus, setConnectionStatus] = useState("");
  const [isConnected, setIsConnected] = useState(false);

  // ── BEACON Identity ──
  const [isAnnounced, setIsAnnounced] = useState(false);
  const [announcing, setAnnouncing] = useState(false);
  const beaconKeypairRef = useRef<nacl.BoxKeyPair | null>(null);

  // ── Contacts & Bonds ──
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [bondRequests, setBondRequests] = useState<BondRequest[]>([]);
  const [newContactAddr, setNewContactAddr] = useState("");
  const [sendingBond, setSendingBond] = useState(false);

  // ── Chat State ──
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [peerAddress, setPeerAddress] = useState("");
  const [peerWpk, setPeerWpk] = useState("");
  const [peerNfd, setPeerNfd] = useState<string | undefined>();
  const [myNfd, setMyNfd] = useState<string | undefined>();
  const [onChainWpk, setOnChainWpk] = useState<string | null>(null);
  const [identityMismatch, setIdentityMismatch] = useState(false);

  // ── Scanning State ──
  const [scanning, setScanning] = useState(false);
  const [pendingOffer, setPendingOffer] = useState<{
    fromAddress: string;
    wpk: string;
    ts: number;
    nfd?: string;
  } | null>(null);

  // ── Refs ──
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileChunksRef = useRef<Map<string, Uint8Array[]>>(new Map());

  // ── Scroll ──
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // ── Load contacts when wallet connects ──
  useEffect(() => {
    if (activeAddress) {
      setContacts(getContacts(activeAddress));
    }
  }, [activeAddress]);

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      if (connRef.current) connRef.current.close();
      if (peerRef.current) peerRef.current.destroy();
    };
  }, []);

  // ═══════════════════════════════════════════════════════════════
  //  BEACON Web Key Derivation
  // ═══════════════════════════════════════════════════════════════

  const getBeaconKeypair = useCallback(async (): Promise<nacl.BoxKeyPair> => {
    if (beaconKeypairRef.current) return beaconKeypairRef.current;
    if (!activeAddress || !signTransactions)
      throw new Error("Wallet not connected");

    const domainTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: activeAddress,
      to: activeAddress,
      amount: 0,
      note: new TextEncoder().encode(BEACON_DOMAIN_NOTE),
      suggestedParams: {
        genesisHash: BEACON_GENESIS_HASH_MAINNET,
        genesisID: "mainnet-v1.0",
        firstRound: 10,
        lastRound: 20,
        fee: 0,
        flatFee: true,
      } as any,
    });

    const encoded = algosdk.encodeUnsignedTransaction(domainTxn);
    const signed = await signTransactions([encoded]);
    if (!signed?.[0]) throw new Error("Signature cancelled");

    const decoded = algosdk.decodeSignedTransaction(signed[0]);
    
    // Extract entropy from whatever signature type is present
    let entropy: Uint8Array | null = null;
    if (decoded.sig) {
      entropy = decoded.sig;
    } else if (decoded.msig) {
      // For multisig, hash the entire msig structure to get a deterministic seed
      entropy = nacl.hash(algosdk.encodeObj(decoded.msig));
    } else if (decoded.lsig) {
      // For logicsig, use the logic + sigs
      entropy = nacl.hash(algosdk.encodeObj(decoded.lsig));
    }

    if (!entropy) throw new Error("No signature or auth proof found in transaction");

    const keypair = deriveKeyFromSignature(entropy);
    beaconKeypairRef.current = keypair;

    // Force identity mismatch check now that we have derived the key
    if (onChainWpk) {
      const derivedWpk = uint8ToBase64(keypair.publicKey);
      setIdentityMismatch(derivedWpk !== onChainWpk);
    }

    return keypair;
  }, [activeAddress, signTransactions, onChainWpk]);

  // ═══════════════════════════════════════════════════════════════
  //  Check Announce Status
  // ═══════════════════════════════════════════════════════════════

  const checkAnnounceStatus = useCallback(async () => {
    if (!activeAddress) return;
    try {
      const url = `${MAINNET_ALGONODE_INDEXER}/v2/accounts/${activeAddress}/transactions?note-prefix=${BEACON_PREFIX_B64}&limit=50`;
      const res = await fetch(url);
      const data = await res.json();

      let latestWpk: string | null = null;

      for (const tx of data.transactions || []) {
        if (!tx.note || tx["payment-transaction"]?.receiver !== BEACON_PROTOCOL_ADDRESS) continue;
        try {
          const noteStr = new TextDecoder().decode(base64ToUint8(tx.note));
          const payload = parsePlaintextBeaconNote(noteStr);
          if (payload?.type === "announce") {
            latestWpk = payload.wpk;
            setIsAnnounced(true);
            setOnChainWpk(payload.wpk);
            break;
          }
        } catch { /* skip */ }
      }

      if (latestWpk) {
        // Check for mismatch if keypair is already derived
        if (beaconKeypairRef.current) {
          const derivedWpk = uint8ToBase64(beaconKeypairRef.current.publicKey);
          setIdentityMismatch(derivedWpk !== latestWpk);
        }
      } else {
        setIsAnnounced(false);
      }
    } catch { /* skip */ }
  }, [activeAddress]);

  useEffect(() => {
    checkAnnounceStatus();
  }, [checkAnnounceStatus]);

  // Check mismatch whenever keypair is derived
  useEffect(() => {
    if (onChainWpk && beaconKeypairRef.current) {
      const derivedWpk = uint8ToBase64(beaconKeypairRef.current.publicKey);
      setIdentityMismatch(derivedWpk !== onChainWpk);
    }
  }, [onChainWpk]);

  // ═══════════════════════════════════════════════════════════════
  //  Announce (One-Time Inbox Initialization)
  // ═══════════════════════════════════════════════════════════════

  const handleAnnounce = useCallback(async () => {
    if (!activeAddress || !signTransactions || !algodClient) {
      toast.error("Connect your wallet first");
      return;
    }
    setAnnouncing(true);
    try {
      const keypair = await getBeaconKeypair();
      const nfdName = await getNfdDomain(activeAddress);
      if (nfdName) setMyNfd(nfdName);

      const payload: BeaconNote = {
        proto: "BEACON/1",
        type: "announce",
        wpk: uint8ToBase64(keypair.publicKey),
        ts: Date.now(),
        nfd: nfdName || undefined,
      };

      const noteBytes = new TextEncoder().encode(
        `${BEACON_PREFIX}${btoa(JSON.stringify(payload))}`
      );

      const suggestedParams = await algodClient.getTransactionParams().do();
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: activeAddress,
        to: BEACON_PROTOCOL_ADDRESS,
        amount: 0,
        note: noteBytes,
        suggestedParams: { ...suggestedParams, fee: 1000, flatFee: true },
      });

      const signed = await signTransactions([
        algosdk.encodeUnsignedTransaction(txn),
      ]);
      if (!signed?.[0]) throw new Error("Cancelled");

      await algodClient.sendRawTransaction(signed[0]).do();
      toast.success("BEACON inbox initialized!");
      setIsAnnounced(true);
    } catch (err: any) {
      toast.error(err.message || "Announce failed");
    } finally {
      setAnnouncing(false);
    }
  }, [activeAddress, signTransactions, algodClient, getBeaconKeypair]);

  // ═══════════════════════════════════════════════════════════════
  //  Lookup Recipient WPK from Chain
  // ═══════════════════════════════════════════════════════════════

  const lookupWpk = useCallback(
    async (
      targetAddress: string
    ): Promise<{ wpk: string; nfd?: string } | null> => {
      try {
        const url = `${MAINNET_ALGONODE_INDEXER}/v2/accounts/${targetAddress}/transactions?note-prefix=${BEACON_PREFIX_B64}&limit=50`;
        const res = await fetch(url);
        const data = await res.json();

        for (const tx of data.transactions || []) {
          if (!tx.note || tx["payment-transaction"]?.receiver !== BEACON_PROTOCOL_ADDRESS) continue;
          try {
            const noteStr = new TextDecoder().decode(base64ToUint8(tx.note));
            const payload = parsePlaintextBeaconNote(noteStr);
            if (
              payload &&
              (payload.type === "announce" ||
                payload.type === ("announce-rotate" as any))
            ) {
              return { wpk: payload.wpk, nfd: payload.nfd };
            }
          } catch {
            /* skip */
          }
        }
        return null;
      } catch {
        return null;
      }
    },
    []
  );

  // ═══════════════════════════════════════════════════════════════
  //  Send Bond Request
  // ═══════════════════════════════════════════════════════════════

  const sendBondRequest = useCallback(
    async (recipientAddress: string) => {
      if (!activeAddress || !signTransactions || !algodClient) {
        toast.error("Connect wallet first");
        return;
      }
      setSendingBond(true);
      try {
        let targetAddr = recipientAddress.trim();

        // Resolve NFD
        if (targetAddr.toLowerCase().endsWith(".algo")) {
          const nfdData = await fetch(
            `https://api.nf.domains/nfd/${targetAddr.toLowerCase()}?view=tiny`
          ).then((r) => r.json());
          if (nfdData.depositAccount) {
            targetAddr = nfdData.depositAccount;
          } else {
            throw new Error("Could not resolve NFD");
          }
        }

        // Check if already a contact
        if (contacts.some((c) => c.address === targetAddr)) {
          toast.info("Already in your contacts");
          return;
        }

        // Lookup their wpk
        const recipientInfo = await lookupWpk(targetAddr);
        if (!recipientInfo) {
          toast.error(
            "This address hasn't initialized their BEACON inbox yet"
          );
          return;
        }

        const keypair = await getBeaconKeypair();

        // Guard against mismatched identity
        if (onChainWpk && uint8ToBase64(keypair.publicKey) !== onChainWpk) {
          setIdentityMismatch(true);
          toast.error("Identity mismatch — update your BEACON identity first");
          setSendingBond(false);
          return;
        }

        const nfdName = myNfd || (await getNfdDomain(activeAddress));

        const payload: BeaconNote = {
          proto: "BEACON/1",
          type: "bond-request",
          wpk: uint8ToBase64(keypair.publicKey),
          ts: Date.now(),
          exp: Date.now() + BOND_REQUEST_EXPIRY_MS,
          nfd: nfdName || undefined,
        };

        const recipientWpk = base64ToUint8(recipientInfo.wpk);
        const noteStr = encryptBeaconNote(payload, recipientWpk);
        const noteBytes = new TextEncoder().encode(noteStr);

        if (noteBytes.length > 1024) {
          throw new Error("Note payload too large");
        }

        const suggestedParams = await algodClient.getTransactionParams().do();
        const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          from: activeAddress,
          to: BEACON_PROTOCOL_ADDRESS,
          amount: 0,
          note: noteBytes,
          suggestedParams: { ...suggestedParams, fee: 1000, flatFee: true },
        });

        const signed = await signTransactions([
          algosdk.encodeUnsignedTransaction(txn),
        ]);
        if (!signed?.[0]) throw new Error("Cancelled");

        await algodClient.sendRawTransaction(signed[0]).do();
        toast.success("Bond request sent!");
        setNewContactAddr("");
      } catch (err: any) {
        toast.error(err.message || "Bond request failed");
      } finally {
        setSendingBond(false);
      }
    },
    [
      activeAddress,
      signTransactions,
      algodClient,
      contacts,
      lookupWpk,
      getBeaconKeypair,
      myNfd,
    ]
  );

  // ═══════════════════════════════════════════════════════════════
  //  Accept Bond Request → Add Contact
  // ═══════════════════════════════════════════════════════════════

  const acceptBond = useCallback(
    async (request: BondRequest) => {
      if (!activeAddress || !signTransactions || !algodClient) return;

      try {
        const keypair = await getBeaconKeypair();
        const nfdName = myNfd || (await getNfdDomain(activeAddress));

        // Send bond-accept back to the requester
        const payload: BeaconNote = {
          proto: "BEACON/1",
          type: "bond-accept",
          wpk: uint8ToBase64(keypair.publicKey),
          ts: Date.now(),
          nfd: nfdName || undefined,
        };

        const recipientWpk = base64ToUint8(request.wpk);
        const noteStr = encryptBeaconNote(payload, recipientWpk);
        const noteBytes = new TextEncoder().encode(noteStr);

        const suggestedParams = await algodClient.getTransactionParams().do();
        const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          from: activeAddress,
          to: BEACON_PROTOCOL_ADDRESS,
          amount: 0,
          note: noteBytes,
          suggestedParams: { ...suggestedParams, fee: 1000, flatFee: true },
        });

        const signed = await signTransactions([
          algosdk.encodeUnsignedTransaction(txn),
        ]);
        if (!signed?.[0]) throw new Error("Cancelled");

        await algodClient.sendRawTransaction(signed[0]).do();

        // Add to local contacts
        const newContact: Contact = {
          address: request.fromAddress,
          wpk: request.wpk,
          nfd: request.nfd,
          addedAt: Date.now(),
        };

        const updated = [...contacts, newContact];
        setContacts(updated);
        saveContacts(activeAddress, updated);

        // Remove from pending requests
        setBondRequests((prev) =>
          prev.filter((r) => r.fromAddress !== request.fromAddress)
        );

        toast.success(
          `Added ${request.nfd || shortenAddr(request.fromAddress)} as a contact!`
        );
      } catch (err: any) {
        toast.error(err.message || "Failed to accept bond");
      }
    },
    [
      activeAddress,
      signTransactions,
      algodClient,
      contacts,
      getBeaconKeypair,
      myNfd,
    ]
  );

  // ═══════════════════════════════════════════════════════════════
  //  Block a WPK
  // ═══════════════════════════════════════════════════════════════

  const blockContact = useCallback(
    (wpk: string, address: string) => {
      // Add to block list
      const blocked = getBlockedWpks();
      if (!blocked.includes(wpk)) {
        blocked.push(wpk);
        setBlockedWpks(blocked);
      }

      // Remove from contacts
      if (activeAddress) {
        const updated = contacts.filter((c) => c.wpk !== wpk);
        setContacts(updated);
        saveContacts(activeAddress, updated);
      }

      // Remove from bond requests
      setBondRequests((prev) => prev.filter((r) => r.wpk !== wpk));

      toast.info(`Blocked ${shortenAddr(address)}`);
    },
    [activeAddress, contacts]
  );

  // ═══════════════════════════════════════════════════════════════
  //  Scan BEACON Protocol Address
  // ═══════════════════════════════════════════════════════════════

  const scanBeacon = useCallback(async () => {
    if (!activeAddress) return;
    setScanning(true);
    try {
      const keypair = await getBeaconKeypair();

      // Guard against mismatched identity
      if (onChainWpk && uint8ToBase64(keypair.publicKey) !== onChainWpk) {
        setIdentityMismatch(true);
        toast.error("Identity mismatch — update your BEACON identity first");
        setScanning(false);
        return;
      }

      toast.info("Scanning for messages...");
      const blocked = getBlockedWpks();

      const url = `${MAINNET_ALGONODE_INDEXER}/v2/transactions?address=${BEACON_PROTOCOL_ADDRESS}&address-role=receiver&note-prefix=${BEACON_PREFIX_B64}&limit=200`;
      const res = await fetch(url);
      const data = await res.json();
      const txns = data.transactions || [];

      const newBondRequests: BondRequest[] = [];
      const newBondAccepts: {
        fromAddress: string;
        wpk: string;
        nfd?: string;
      }[] = [];
      let foundAnswer: {
        fromAddress: string;
        wpk: string;
        ts: number;
        nfd?: string;
      } | null = null;

      let maxRound = 0;

      for (const tx of txns) {
        if (!tx.note) continue;
        const round = tx["confirmed-round"] || 0;
        if (round > maxRound) maxRound = round;

        const noteStr = new TextDecoder().decode(base64ToUint8(tx.note));
        const payload = decryptBeaconNote(noteStr, keypair.secretKey);
        if (!payload) continue;

        // Skip blocked
        if (blocked.includes(payload.wpk)) continue;

        // Skip expired
        if (payload.exp && payload.exp < Date.now()) continue;

        const senderAddr = tx.sender;

        switch (payload.type) {
          case "bond-request":
            // Only show if not already a contact
            if (
              !contacts.some((c) => c.address === senderAddr) &&
              senderAddr !== activeAddress
            ) {
              newBondRequests.push({
                fromAddress: senderAddr,
                wpk: payload.wpk,
                nfd: payload.nfd,
                ts: payload.ts,
                round,
              });
            }
            break;

          case "bond-accept":
            if (!contacts.some((c) => c.address === senderAddr)) {
              newBondAccepts.push({
                fromAddress: senderAddr,
                wpk: payload.wpk,
                nfd: payload.nfd,
              });
            }
            break;

          case "offer":
            // Someone wants to chat with us
            if (
              contacts.some((c) => c.address === senderAddr) &&
              !foundAnswer
            ) {
              setPendingOffer({
                fromAddress: senderAddr,
                wpk: payload.wpk,
                ts: payload.ts,
                nfd: payload.nfd,
              });
            }
            break;

          case "answer":
            // Someone answered our offer
            if (!foundAnswer) {
              foundAnswer = {
                fromAddress: senderAddr,
                wpk: payload.wpk,
                ts: payload.ts,
                nfd: payload.nfd,
              };
            }
            break;
        }
      }

      // Process bond accepts — add as contacts
      for (const accept of newBondAccepts) {
        const newContact: Contact = {
          address: accept.fromAddress,
          wpk: accept.wpk,
          nfd: accept.nfd,
          addedAt: Date.now(),
        };
        const current = getContacts(activeAddress);
        if (!current.some((c) => c.address === accept.fromAddress)) {
          const updated = [...current, newContact];
          saveContacts(activeAddress, updated);
          setContacts(updated);
          toast.success(
            `${accept.nfd || shortenAddr(accept.fromAddress)} accepted your bond request!`
          );
        }
      }

      // Deduplicate bond requests
      const uniqueRequests = newBondRequests.filter(
        (r, i, arr) =>
          arr.findIndex((x) => x.fromAddress === r.fromAddress) === i
      );
      if (uniqueRequests.length > 0) {
        setBondRequests(uniqueRequests);
        toast.info(`${uniqueRequests.length} pending bond request(s)`);
      }

      if (maxRound > 0) {
        setLastSeenRound(activeAddress, maxRound);
      }
    } catch (err: any) {
      console.error("Scan error:", err);
      toast.error("Scan failed");
    } finally {
      setScanning(false);
    }
  }, [activeAddress, getBeaconKeypair, contacts]);

  // ═══════════════════════════════════════════════════════════════
  //  WebRTC Connection Handling
  // ═══════════════════════════════════════════════════════════════

  const startHeartbeat = useCallback(() => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      if (connRef.current?.open) {
        connRef.current.send({ type: "heartbeat" });
      }
    }, 15_000);
  }, []);

  const resetConnection = useCallback(() => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    if (pollRef.current) clearInterval(pollRef.current);
    if (connRef.current) connRef.current.close();
    if (peerRef.current) peerRef.current.destroy();
    connRef.current = null;
    peerRef.current = null;
    setIsConnected(false);
    setConnectionStatus("");
    setPendingOffer(null);
  }, []);

  const goHome = useCallback(() => {
    resetConnection();
    setPhase("home");
    setMessages([]);
    setPeerAddress("");
    setPeerWpk("");
    setPeerNfd(undefined);
  }, [resetConnection]);

  const handleDataChannel = useCallback(
    (conn: DataConnection) => {
      connRef.current = conn;

      conn.on("open", () => {
        setIsConnected(true);
        setConnectionStatus("Connected");
        setPhase("chat");
        startHeartbeat();
        toast.success("Secure P2P channel established!");

        // Load chat history
        if (activeAddress && peerAddress) {
          const history = getChatHistory(activeAddress, peerAddress);
          if (history.length > 0) {
            setMessages(history);
          }
        }
      });

      conn.on("data", (data: any) => {
        if (!data) return;
        if (data.type === "heartbeat") return;

        if (data.type === "file-meta") {
          fileChunksRef.current.set(data.fileId, []);
          setMessages((prev) => {
            const updated = [
              ...prev,
              {
                text: `📎 Receiving: ${data.fileName} (${formatFileSize(data.fileSize)})`,
                sender: "peer" as const,
                timestamp: Date.now(),
                type: "file-meta" as const,
                fileName: data.fileName,
                fileSize: data.fileSize,
                fileType: data.fileType,
                fileId: data.fileId,
              },
            ];
            if (activeAddress && peerAddress)
              saveChatHistory(activeAddress, peerAddress, updated);
            return updated;
          });
          return;
        }

        if (data.type === "file-chunk") {
          const chunks = fileChunksRef.current.get(data.fileId);
          if (chunks) chunks.push(new Uint8Array(data.data));
          return;
        }

        if (data.type === "file-complete") {
          const chunks = fileChunksRef.current.get(data.fileId);
          if (chunks) {
            const blob = new Blob(
              chunks.map((c) => new Uint8Array(c)) as BlobPart[],
              { type: data.fileType }
            );
            const url = URL.createObjectURL(blob);
            setMessages((prev) => {
              const updated = [
                ...prev,
                {
                  text: `📥 ${data.fileName}`,
                  sender: "peer" as const,
                  timestamp: Date.now(),
                  type: "file-complete" as const,
                  fileName: data.fileName,
                  fileId: data.fileId,
                  fileType: data.fileType,
                  fileUrl: url,
                },
              ];
              if (activeAddress && peerAddress)
                saveChatHistory(activeAddress, peerAddress, updated);
              return updated;
            });
            fileChunksRef.current.delete(data.fileId);
          }
          return;
        }

        // Regular text message
        setMessages((prev) => {
          const updated = [
            ...prev,
            {
              text: data.text || "",
              sender: "peer" as const,
              timestamp: Date.now(),
              type: "text" as const,
            },
          ];
          if (activeAddress && peerAddress)
            saveChatHistory(activeAddress, peerAddress, updated);
          return updated;
        });
      });

      conn.on("close", () => {
        setIsConnected(false);
        setConnectionStatus("Disconnected");
        toast.info("Peer disconnected");
      });

      conn.on("error", (err) => {
        console.error("Connection error:", err);
        setIsConnected(false);
      });
    },
    [activeAddress, peerAddress, startHeartbeat]
  );

  // ═══════════════════════════════════════════════════════════════
  //  Initiate Chat with a Contact (Send BEACON Offer)
  // ═══════════════════════════════════════════════════════════════

  const initiateChat = useCallback(
    async (contact: Contact) => {
      if (!activeAddress || !signTransactions || !algodClient) {
        toast.error("Connect wallet");
        return;
      }

      try {
        setPeerAddress(contact.address);
        setPeerWpk(contact.wpk);
        setPeerNfd(contact.nfd);
        setPhase("waiting");
        setConnectionStatus("Sending encrypted offer...");

        const keypair = await getBeaconKeypair();
        const now = Date.now();

        // ── Send BEACON offer on-chain ──
        const payload: BeaconNote = {
          proto: "BEACON/1",
          type: "offer",
          wpk: uint8ToBase64(keypair.publicKey),
          ts: now,
          exp: now + OFFER_EXPIRY_MS,
          nfd: myNfd,
        };

        const recipientWpk = base64ToUint8(contact.wpk);
        const noteStr = encryptBeaconNote(payload, recipientWpk);
        const noteBytes = new TextEncoder().encode(noteStr);

        const suggestedParams = await algodClient.getTransactionParams().do();
        const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          from: activeAddress,
          to: BEACON_PROTOCOL_ADDRESS,
          amount: 0,
          note: noteBytes,
          suggestedParams: { ...suggestedParams, fee: 1000, flatFee: true },
        });

        const signed = await signTransactions([
          algosdk.encodeUnsignedTransaction(txn),
        ]);
        if (!signed?.[0]) throw new Error("Cancelled");

        await algodClient.sendRawTransaction(signed[0]).do();
        setConnectionStatus("Offer sent. Waiting for answer...");

        // ── Derive session token and register as WebRTC peer ──
        const sharedSecret = nacl.box.before(recipientWpk, keypair.secretKey);
        const sessionToken = deriveSessionToken(sharedSecret, now);

        const iceServers: RTCIceServer[] = [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ];

        const turnUser = (import.meta as any).env?.VITE_TURN_USERNAME;
        const turnPass = (import.meta as any).env?.VITE_TURN_CREDENTIAL;
        if (turnUser && turnPass) {
          iceServers.push(
            {
              urls: "turn:a.relay.metered.ca:80",
              username: turnUser,
              credential: turnPass,
            },
            {
              urls: "turn:a.relay.metered.ca:443",
              username: turnUser,
              credential: turnPass,
            },
            {
              urls: "turn:a.relay.metered.ca:443?transport=tcp",
              username: turnUser,
              credential: turnPass,
            }
          );
        }

        const peer = new Peer(sessionToken, { config: { iceServers } });
        peerRef.current = peer;

        peer.on("open", () => {
          setConnectionStatus("Listening on session token...");
        });

        peer.on("connection", (conn) => {
          handleDataChannel(conn);
        });

        peer.on("error", (err) => {
          console.error("Peer error:", err);
          // Don't reset — allow rescan
        });

        // ── Poll for answer ──
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          try {
            const scanUrl = `${MAINNET_ALGONODE_INDEXER}/v2/transactions?address=${BEACON_PROTOCOL_ADDRESS}&address-role=receiver&note-prefix=${BEACON_PREFIX_B64}&limit=50`;
            const scanRes = await fetch(scanUrl);
            const scanData = await scanRes.json();

            for (const tx of scanData.transactions || []) {
              if (!tx.note) continue;
              const scanNoteStr = new TextDecoder().decode(
                base64ToUint8(tx.note)
              );
              const decrypted = decryptBeaconNote(
                scanNoteStr,
                keypair.secretKey
              );
              if (decrypted?.type === "answer" && tx.sender === contact.address) {
                // Answer found — peer should be connecting
                setConnectionStatus("Answer received! Connecting...");
                if (pollRef.current) clearInterval(pollRef.current);
                break;
              }
            }
          } catch {
            /* poll error, retry next interval */
          }
        }, POLL_INTERVAL_ACTIVE);
      } catch (err: any) {
        toast.error(err.message || "Failed to initiate chat");
        goHome();
      }
    },
    [
      activeAddress,
      signTransactions,
      algodClient,
      getBeaconKeypair,
      myNfd,
      handleDataChannel,
      goHome,
    ]
  );

  // ═══════════════════════════════════════════════════════════════
  //  Answer a BEACON Offer (Accept Incoming Chat)
  // ═══════════════════════════════════════════════════════════════

  const answerOffer = useCallback(
    async (offer: {
      fromAddress: string;
      wpk: string;
      ts: number;
      nfd?: string;
    }) => {
      if (!activeAddress || !signTransactions || !algodClient) return;

      try {
        setPeerAddress(offer.fromAddress);
        setPeerWpk(offer.wpk);
        setPeerNfd(offer.nfd);
        setPhase("connecting");
        setConnectionStatus("Sending encrypted answer...");

        const keypair = await getBeaconKeypair();

        // ── Send BEACON answer on-chain ──
        const payload: BeaconNote = {
          proto: "BEACON/1",
          type: "answer",
          wpk: uint8ToBase64(keypair.publicKey),
          ts: offer.ts, // Echo the original ts for session token derivation
        };

        const senderWpk = base64ToUint8(offer.wpk);
        const noteStr = encryptBeaconNote(payload, senderWpk);
        const noteBytes = new TextEncoder().encode(noteStr);

        const suggestedParams = await algodClient.getTransactionParams().do();
        const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          from: activeAddress,
          to: BEACON_PROTOCOL_ADDRESS,
          amount: 0,
          note: noteBytes,
          suggestedParams: { ...suggestedParams, fee: 1000, flatFee: true },
        });

        const signed = await signTransactions([
          algosdk.encodeUnsignedTransaction(txn),
        ]);
        if (!signed?.[0]) throw new Error("Cancelled");

        await algodClient.sendRawTransaction(signed[0]).do();

        // ── Derive same session token and connect ──
        const sharedSecret = nacl.box.before(senderWpk, keypair.secretKey);
        const sessionToken = deriveSessionToken(sharedSecret, offer.ts);

        setConnectionStatus("Connecting to peer...");

        const iceServers: RTCIceServer[] = [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ];

        const turnUser = (import.meta as any).env?.VITE_TURN_USERNAME;
        const turnPass = (import.meta as any).env?.VITE_TURN_CREDENTIAL;
        if (turnUser && turnPass) {
          iceServers.push(
            {
              urls: "turn:a.relay.metered.ca:80",
              username: turnUser,
              credential: turnPass,
            },
            {
              urls: "turn:a.relay.metered.ca:443",
              username: turnUser,
              credential: turnPass,
            },
            {
              urls: "turn:a.relay.metered.ca:443?transport=tcp",
              username: turnUser,
              credential: turnPass,
            }
          );
        }

        const peer = new Peer({ config: { iceServers } });
        peerRef.current = peer;

        peer.on("open", () => {
          const conn = peer.connect(sessionToken, { reliable: true });
          handleDataChannel(conn);
        });

        peer.on("error", (err) => {
          console.error("Peer error:", err);
          toast.error("Connection failed");
          goHome();
        });

        setPendingOffer(null);
      } catch (err: any) {
        toast.error(err.message || "Failed to answer offer");
        goHome();
      }
    },
    [
      activeAddress,
      signTransactions,
      algodClient,
      getBeaconKeypair,
      handleDataChannel,
      goHome,
    ]
  );

  // ═══════════════════════════════════════════════════════════════
  //  Send Message / File
  // ═══════════════════════════════════════════════════════════════

  const sendMessage = useCallback(() => {
    if (!inputText.trim() || !connRef.current?.open) return;
    connRef.current.send({ type: "text", text: inputText.trim() });
    setMessages((prev) => {
      const updated = [
        ...prev,
        {
          text: inputText.trim(),
          sender: "me" as const,
          timestamp: Date.now(),
          type: "text" as const,
        },
      ];
      if (activeAddress && peerAddress)
        saveChatHistory(activeAddress, peerAddress, updated);
      return updated;
    });
    setInputText("");
  }, [inputText, activeAddress, peerAddress]);

  const sendFile = useCallback(
    async (file: File) => {
      if (!connRef.current?.open) return;
      const fileId = crypto.randomUUID();

      connRef.current.send({
        type: "file-meta",
        fileId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
      });

      const buffer = await file.arrayBuffer();
      const data = new Uint8Array(buffer);

      setMessages((prev) => {
        const updated = [
          ...prev,
          {
            text: `📎 ${file.name}`,
            sender: "me" as const,
            timestamp: Date.now(),
            type: "file-complete" as const,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
            fileId,
            fileUrl: URL.createObjectURL(file),
          },
        ];
        if (activeAddress && peerAddress)
          saveChatHistory(activeAddress, peerAddress, updated);
        return updated;
      });

      for (let offset = 0; offset < data.length; offset += 16384) {
        connRef.current.send({
          type: "file-chunk",
          fileId,
          data: data.slice(offset, offset + 16384),
        });
        await new Promise((r) => setTimeout(r, 10));
      }

      connRef.current.send({
        type: "file-complete",
        fileId,
        fileName: file.name,
        fileType: file.type,
      });
    },
    [activeAddress, peerAddress]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const file = e.clipboardData.files[0];
      if (file?.type.startsWith("image/")) sendFile(file);
    },
    [sendFile]
  );

  // ═══════════════════════════════════════════════════════════════
  //  Render Helpers
  // ═══════════════════════════════════════════════════════════════

  const displayName = (address: string, nfd?: string) =>
    nfd || shortenAddr(address);

  // ═══════════════════════════════════════════════════════════════
  //  Render
  // ═══════════════════════════════════════════════════════════════

  return (
    <div className="flex flex-col items-center justify-center w-full px-4 py-8 min-h-[80vh]">
      <div className="w-full max-w-2xl">
        {/* ═══════════════════════════════════════════════════════
            HOME PHASE
        ═══════════════════════════════════════════════════════ */}
        {phase === "home" && (
          <div className="bg-[#111] rounded-2xl p-8 border border-[#222] shadow-2xl">
            {/* Header */}
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-primary-orange/20 flex items-center justify-center">
                <span className="text-xl">📡</span>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white tracking-tight">
                  BEACON Chat
                </h1>
                <p className="text-[10px] text-gray-500 uppercase tracking-[0.2em] font-bold">
                  Serverless Encrypted P2P
                </p>
              </div>
            </div>

            {/* Wallet Status */}
            {!activeAddress ? (
              <div className="p-6 rounded-xl bg-red-500/5 border border-red-500/20 text-center">
                <p className="text-red-400 text-sm font-medium">
                  Connect your wallet to continue
                </p>
              </div>
            ) : (
              <>
                {/* Announce / Identity Status */}
                {!isAnnounced ? (
                  <div className="mb-6">
                    <div className="p-6 rounded-xl bg-primary-orange/5 border border-primary-orange/20 mb-4">
                      <p className="text-primary-orange text-xs font-bold uppercase tracking-widest mb-2">
                        Initialize Your Inbox
                      </p>
                      <p className="text-gray-400 text-xs leading-relaxed">
                        Publish your encryption key on-chain so others can send
                        you encrypted messages. This is a one-time 0.001 ALGO
                        transaction.
                      </p>
                    </div>
                    <button
                      onClick={handleAnnounce}
                      disabled={announcing}
                      className="w-full py-4 bg-primary-orange text-white rounded-xl font-bold
                        shadow-lg shadow-primary-orange/20 hover:scale-[1.02] active:scale-[0.98]
                        transition-all disabled:opacity-40"
                    >
                      {announcing
                        ? "Broadcasting..."
                        : "Initialize BEACON Inbox"}
                    </button>
                  </div>
                ) : identityMismatch ? (
                  <div className="mb-6">
                    <div className="p-6 rounded-xl bg-red-500/10 border border-red-500/30 mb-4">
                      <p className="text-red-400 text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
                        <MdBlock size={14} /> Identity Mismatch
                      </p>
                      <p className="text-gray-400 text-xs leading-relaxed mb-4">
                        Your on-chain key doesn't match your current wallet signature. 
                        This happens if you rekeyed or changed your signing method.
                      </p>
                      
                      {/* Diagnostics */}
                      <div className="p-3 bg-black/40 rounded-lg border border-white/5 space-y-2 mb-4">
                        <div className="flex justify-between items-center">
                          <span className="text-[9px] text-gray-500 uppercase font-bold">On-Chain WPK</span>
                          <span className="text-[9px] text-gray-400 font-mono">{onChainWpk ? shortenAddr(onChainWpk) : "None"}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-[9px] text-gray-500 uppercase font-bold">Derived WPK</span>
                          <span className="text-[9px] text-primary-orange font-mono">
                            {beaconKeypairRef.current ? shortenAddr(uint8ToBase64(beaconKeypairRef.current.publicKey)) : "Not Derived"}
                          </span>
                        </div>
                      </div>

                    </div>
                    <button
                      onClick={handleAnnounce}
                      disabled={announcing}
                      className="w-full py-4 bg-red-500 text-white rounded-xl font-bold
                        shadow-lg shadow-red-500/20 hover:scale-[1.02] active:scale-[0.98]
                        transition-all disabled:opacity-40"
                    >
                      {announcing ? "Updating..." : "Update BEACON Identity"}
                    </button>
                  </div>
                ) : (
                  <div className="mb-6">
                    <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-green-500/5 border border-green-500/20">
                      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-green-400 text-xs font-bold uppercase tracking-widest">
                        Inbox Active
                      </span>
                      <span className="ml-auto text-gray-600 text-[10px] font-mono">
                        {shortenAddr(activeAddress)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Navigation / Actions Bar */}
                <div className="grid grid-cols-2 gap-3 mb-6">
                  <button
                    onClick={scanBeacon}
                    disabled={scanning || !isAnnounced}
                    className="py-3 rounded-xl border border-primary-orange/30 text-primary-orange
                      font-bold hover:bg-primary-orange/5 transition-all disabled:opacity-30
                      flex items-center justify-center gap-2"
                  >
                    <MdRefresh
                      size={18}
                      className={scanning ? "animate-spin" : ""}
                    />
                    {scanning ? "Scanning..." : "Scan Messages"}
                  </button>

                  <button
                    onClick={() => setPhase("bond-requests")}
                    className="relative py-3 rounded-xl bg-[#1a1a1a] border border-[#222] text-white
                      font-bold hover:bg-[#222] transition-all flex items-center justify-center gap-2"
                  >
                    <MdPersonAdd size={18} />
                    Requests
                    {bondRequests.length > 0 && (
                      <span className="absolute -top-2 -right-2 w-5 h-5 bg-primary-orange text-white text-[10px] 
                        flex items-center justify-center rounded-full border-2 border-[#111] animate-bounce">
                        {bondRequests.length}
                      </span>
                    )}
                  </button>
                </div>

                {/* Pending Offer Banner */}
                {pendingOffer && (
                  <div className="mb-6 p-4 rounded-xl bg-primary-orange/10 border border-primary-orange/30 animate-pulse">
                    <p className="text-primary-orange text-sm font-bold mb-2">
                      Incoming Chat Request
                    </p>
                    <p className="text-gray-400 text-xs mb-3">
                      {displayName(
                        pendingOffer.fromAddress,
                        pendingOffer.nfd
                      )}{" "}
                      wants to connect
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => answerOffer(pendingOffer)}
                        className="flex-1 py-2 bg-primary-orange text-white rounded-lg text-sm font-bold"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => setPendingOffer(null)}
                        className="px-4 py-2 bg-[#222] text-gray-400 rounded-lg text-sm"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}



                {/* Contacts List */}
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">
                      Contacts ({contacts.length})
                    </p>
                    <button
                      onClick={() => setPhase("contacts")}
                      className="text-primary-orange text-xs font-bold hover:text-primary-orange/80 transition-colors"
                    >
                      + Add
                    </button>
                  </div>

                  {contacts.length === 0 ? (
                    <div className="p-6 rounded-xl bg-[#1a1a1a] border border-[#222] text-center">
                      <p className="text-gray-500 text-sm">No contacts yet</p>
                      <p className="text-gray-600 text-xs mt-1">
                        Add a contact by sending a bond request
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {contacts.map((contact) => (
                        <button
                          key={contact.address}
                          onClick={() => initiateChat(contact)}
                          className="w-full flex items-center gap-3 p-4 rounded-xl bg-[#1a1a1a] border border-[#222]
                            hover:border-primary-orange/30 hover:bg-[#1e1e1e] transition-all text-left group"
                        >
                          <div className="w-10 h-10 rounded-full bg-primary-orange/10 flex items-center justify-center shrink-0">
                            <MdPerson
                              size={18}
                              className="text-primary-orange"
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-medium truncate">
                              {displayName(contact.address, contact.nfd)}
                            </p>
                            <p className="text-gray-600 text-[10px] font-mono truncate">
                              {contact.address}
                            </p>
                          </div>
                          <MdSend
                            size={16}
                            className="text-gray-600 group-hover:text-primary-orange transition-colors shrink-0"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Footer */}
            <div className="pt-4 border-t border-[#222] text-center">
              <p className="text-gray-700 text-[9px] uppercase tracking-[0.3em] font-bold">
                No Servers · No Brokers · Just the Chain
              </p>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════
            BOND REQUESTS PHASE
        ═══════════════════════════════════════════════════════ */}
        {phase === "bond-requests" && (
          <div className="bg-[#111] rounded-2xl p-8 border border-[#222] shadow-2xl">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-xl font-bold text-white">Contact Requests</h2>
              <button
                onClick={() => setPhase("home")}
                className="text-gray-500 hover:text-white transition-colors"
              >
                <MdClose size={24} />
              </button>
            </div>

            {bondRequests.length === 0 ? (
              <div className="p-12 text-center">
                <div className="w-16 h-16 bg-[#1a1a1a] rounded-full flex items-center justify-center mx-auto mb-4">
                  <MdPersonAdd size={24} className="text-gray-700" />
                </div>
                <p className="text-gray-500 text-sm">No pending requests</p>
                <button
                  onClick={scanBeacon}
                  className="mt-4 text-primary-orange text-xs font-bold uppercase tracking-widest"
                >
                  Scan for new requests
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {bondRequests.map((req) => (
                  <div
                    key={req.fromAddress}
                    className="flex items-center justify-between p-4 rounded-xl bg-[#1a1a1a] border border-[#222]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary-orange/10 flex items-center justify-center">
                        <MdPersonAdd size={18} className="text-primary-orange" />
                      </div>
                      <div>
                        <p className="text-white text-sm font-medium">
                          {displayName(req.fromAddress, req.nfd)}
                        </p>
                        <p className="text-gray-600 text-[10px] font-mono">
                          {shortenAddr(req.fromAddress)}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => acceptBond(req)}
                        className="px-4 py-2 bg-primary-orange text-white rounded-lg text-xs font-bold
                          hover:bg-primary-orange/80 transition-all"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => blockContact(req.wpk, req.fromAddress)}
                        className="px-3 py-2 bg-red-500/10 text-red-400 rounded-lg text-xs
                          hover:bg-red-500/20 transition-colors"
                      >
                        <MdBlock size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════
            ADD CONTACT PHASE
        ═══════════════════════════════════════════════════════ */}
        {phase === "contacts" && (
          <div className="bg-[#111] rounded-2xl p-8 border border-[#222] shadow-2xl">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-xl font-bold text-white">Add Contact</h2>
              <button
                onClick={() => setPhase("home")}
                className="text-gray-500 hover:text-white transition-colors"
              >
                <MdClose size={24} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest block mb-2">
                  Wallet Address or .algo Name
                </label>
                <input
                  type="text"
                  value={newContactAddr}
                  onChange={(e) => setNewContactAddr(e.target.value)}
                  placeholder="ALGO... or name.algo"
                  className="w-full py-3 px-4 bg-[#1a1a1a] text-white rounded-xl border border-[#222]
                    outline-none focus:border-primary-orange transition-all placeholder:text-gray-600"
                />
              </div>

              <p className="text-gray-500 text-xs leading-relaxed">
                A bond request will be sent as an encrypted on-chain message.
                The recipient must accept before you can chat. Costs 0.001 ALGO.
              </p>

              <button
                onClick={() => sendBondRequest(newContactAddr)}
                disabled={sendingBond || !newContactAddr.trim()}
                className="w-full py-4 bg-primary-orange text-white rounded-xl font-bold
                  shadow-lg shadow-primary-orange/20 hover:scale-[1.02] active:scale-[0.98]
                  transition-all disabled:opacity-30"
              >
                {sendingBond ? "Sending..." : "Send Bond Request"}
              </button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════
            WAITING PHASE (Offer Sent)
        ═══════════════════════════════════════════════════════ */}
        {phase === "waiting" && (
          <div className="bg-[#111] rounded-2xl p-8 border border-[#222] shadow-2xl text-center">
            <div className="w-16 h-16 bg-primary-orange/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="text-2xl">📡</span>
            </div>

            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-orange/10 text-primary-orange text-sm mb-4">
              <span className="w-2 h-2 rounded-full bg-primary-orange animate-pulse" />
              {connectionStatus}
            </div>

            <div className="mb-6">
              <p className="text-gray-400 text-sm">
                Waiting for{" "}
                <span className="text-white font-medium">
                  {displayName(peerAddress, peerNfd)}
                </span>{" "}
                to come online
              </p>
              <p className="text-gray-600 text-xs mt-2">
                Polling the chain every 5 seconds. You can close and rescan
                later.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={goHome}
                className="flex-1 py-3 rounded-xl bg-[#1a1a1a] text-gray-400 font-bold
                  hover:text-white transition-colors border border-[#222]"
              >
                Leave (Rescan Later)
              </button>
              <button
                onClick={goHome}
                className="px-6 py-3 rounded-xl text-red-400 font-bold
                  hover:text-red-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════
            CONNECTING PHASE
        ═══════════════════════════════════════════════════════ */}
        {phase === "connecting" && (
          <div className="bg-[#111] rounded-2xl p-8 border border-[#222] shadow-2xl text-center">
            <div className="animate-spin w-12 h-12 border-4 border-[#222] border-t-primary-orange rounded-full mx-auto mb-6" />
            <p className="text-white font-medium mb-2">{connectionStatus}</p>
            <p className="text-gray-500 text-sm">
              Establishing encrypted WebRTC channel...
            </p>

            <button
              onClick={goHome}
              className="mt-6 text-red-400 hover:text-red-300 text-sm transition-colors font-bold uppercase tracking-widest"
            >
              Cancel
            </button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════
            CHAT PHASE
        ═══════════════════════════════════════════════════════ */}
        {phase === "chat" && (
          <div
            className="bg-[#111] rounded-2xl border border-[#222] shadow-2xl flex flex-col w-full overflow-hidden"
            style={{ height: "80vh" }}
          >
            {/* Chat Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#222] bg-[#0d0d0d]">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-primary-orange/10 flex items-center justify-center">
                    <MdPerson size={18} className="text-primary-orange" />
                  </div>
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#0d0d0d] ${
                      isConnected ? "bg-green-500" : "bg-red-500"
                    }`}
                  />
                </div>
                <div>
                  <h2 className="text-white font-bold text-sm">
                    {displayName(peerAddress, peerNfd)}
                  </h2>
                  <div className="flex items-center gap-1.5">
                    {isConnected ? (
                      <MdSignalWifi4Bar
                        size={10}
                        className="text-green-500"
                      />
                    ) : (
                      <MdSignalWifiOff size={10} className="text-red-500" />
                    )}
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                      {isConnected ? "Encrypted P2P" : "Disconnected"}
                    </p>
                  </div>
                </div>
              </div>
              <button
                onClick={goHome}
                className="text-gray-500 hover:text-white transition-colors"
              >
                <MdClose size={20} />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {messages.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  <p className="text-gray-600 text-sm">
                    Send a message to start the conversation
                  </p>
                </div>
              )}

              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.sender === "me" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                      msg.sender === "me"
                        ? "bg-primary-orange text-white rounded-br-md"
                        : "bg-[#1a1a1a] text-gray-200 border border-[#222] rounded-bl-md"
                    }`}
                  >
                    {/* File Preview */}
                    {msg.type === "file-complete" && msg.fileUrl && (
                      <div className="mb-2">
                        {msg.fileType?.startsWith("image/") ? (
                          <img
                            src={msg.fileUrl}
                            alt={msg.fileName}
                            className="max-w-full max-h-[200px] rounded-lg object-cover cursor-pointer"
                            onClick={() => window.open(msg.fileUrl, "_blank")}
                          />
                        ) : (
                          <a
                            href={msg.fileUrl}
                            download={msg.fileName}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/20 hover:bg-black/40 transition-colors"
                          >
                            <MdAttachFile size={14} />
                            <span className="text-xs truncate">
                              {msg.fileName}
                            </span>
                            {msg.fileSize && (
                              <span className="text-[10px] opacity-60">
                                {formatFileSize(msg.fileSize)}
                              </span>
                            )}
                          </a>
                        )}
                      </div>
                    )}

                    {/* Text */}
                    {msg.type !== "file-meta" && (
                      <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                        {msg.text}
                      </p>
                    )}

                    {msg.type === "file-meta" && (
                      <p className="text-sm opacity-60 italic">{msg.text}</p>
                    )}

                    <p
                      className={`text-[9px] mt-1 ${
                        msg.sender === "me"
                          ? "text-white/40"
                          : "text-gray-600"
                      }`}
                    >
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Reconnection Banner */}
            {!isConnected && phase === "chat" && (
              <div className="px-6 py-3 bg-red-500/10 border-t border-red-500/20 flex items-center justify-between">
                <p className="text-red-400 text-xs font-medium">
                  Connection lost
                </p>
                <button
                  onClick={() => {
                    if (peerAddress && peerWpk) {
                      const contact = contacts.find(
                        (c) => c.address === peerAddress
                      );
                      if (contact) initiateChat(contact);
                    }
                  }}
                  className="px-4 py-1.5 bg-red-500/20 text-red-400 rounded-lg text-xs font-bold
                    hover:bg-red-500/30 transition-colors"
                >
                  Reconnect
                </button>
              </div>
            )}

            {/* Input Area */}
            <div className="px-4 py-3 border-t border-[#222] bg-[#0d0d0d]">
              <div className="flex items-center gap-2">
                <label className="p-2.5 rounded-xl bg-[#1a1a1a] text-gray-500 cursor-pointer
                  hover:text-white hover:bg-[#222] transition-all border border-[#222]">
                  <MdAttachFile size={18} />
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) sendFile(file);
                      e.target.value = "";
                    }}
                  />
                </label>

                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  onPaste={handlePaste}
                  placeholder={
                    isConnected ? "Type a message..." : "Waiting for connection..."
                  }
                  disabled={!isConnected}
                  className="flex-1 py-2.5 px-4 bg-[#1a1a1a] text-white rounded-xl border border-[#222]
                    outline-none focus:border-primary-orange transition-all placeholder:text-gray-600
                    disabled:opacity-40"
                />

                <button
                  onClick={sendMessage}
                  disabled={!inputText.trim() || !isConnected}
                  className="p-2.5 rounded-xl bg-primary-orange text-white
                    hover:bg-primary-orange/80 transition-all disabled:opacity-30 disabled:hover:bg-primary-orange"
                >
                  <MdSend size={18} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
