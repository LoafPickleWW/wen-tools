import { useState, useEffect, useRef, useCallback } from "react";
import { useWallet } from "@txnlab/use-wallet-react";
import algosdk from "algosdk";
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
  nfd?: string;
  sdp?: string;
  part?: number;
  total?: number;
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

async function compress(str: string): Promise<string> {
  const bytes = new TextEncoder().encode(str);
  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();
  writer.write(bytes as any);
  writer.close();
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return uint8ToBase64(concatBytes(...chunks));
}

async function decompress(base64: string): Promise<string> {
  const bytes = base64ToUint8(base64);
  const ds = new DecompressionStream("deflate");
  const writer = ds.writable.getWriter();
  writer.write(bytes as any);
  writer.close();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return new TextDecoder().decode(concatBytes(...chunks));
}

function filterSdp(sdp: string): string {
  const lines = sdp.split("\n");
  let keepSection = true;
  return lines.filter(line => {
    if (line.startsWith("m=")) {
      // Only keep the data channel section, strip audio/video
      keepSection = line.startsWith("m=application");
    }
    if (!keepSection) return false;
    if (line.startsWith("a=candidate:")) {
      return line.includes(" typ host "); // Only keep local network candidates
    }
    return true;
  }).join("\n");
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

// ═══════════════════════════════════════════════════════════════════
//  Main Component
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
  const [messageInput, setMessageInput] = useState("");
  const [peerAddress, setPeerAddress] = useState("");
  const [peerNfd, setPeerNfd] = useState<string | undefined>();
  const [myNfd, setMyNfd] = useState<string | undefined>();
  const [pendingOffer, setPendingOffer] = useState<{
    fromAddress: string;
    wpk: string;
    ts: number;
    nfd?: string;
    sdp?: string;
  } | null>(null);

  // ── WebRTC Refs ──
  const rtcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [scanning, setScanning] = useState(false);

  // ── Cleanup ──
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (rtcRef.current) rtcRef.current.close();
    };
  }, []);

  const goHome = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (rtcRef.current) rtcRef.current.close();
    rtcRef.current = null;
    dcRef.current = null;
    setPhase("home");
    setIsConnected(false);
    setMessages([]);
    setPendingOffer(null);
    setPeerAddress("");
    setPeerNfd(undefined);
  }, []);

  // ── Scroll to Bottom ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Load Contacts ──
  useEffect(() => {
    if (activeAddress) {
      setContacts(getContacts(activeAddress));
      getNfdDomain(activeAddress).then(setMyNfd);
    }
  }, [activeAddress]);

  // ═══════════════════════════════════════════════════════════════════
  //  Core Protocol Logic
  // ═══════════════════════════════════════════════════════════════════

  const getBeaconKeypair = useCallback(async (forceSign = false): Promise<nacl.BoxKeyPair> => {
    if (!forceSign && beaconKeypairRef.current) return beaconKeypairRef.current;
    if (!activeAddress || !signTransactions) throw new Error("Wallet not connected");

    // We no longer store the signature in localStorage for security.
    // The user signs once per session to derive their secret identity.
    const authTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
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

    const signed = await signTransactions([algosdk.encodeUnsignedTransaction(authTxn)]);
    if (!signed?.[0]) throw new Error("Cancelled");

    const decoded = algosdk.decodeSignedTransaction(signed[0]);
    const sig = decoded.sig || (decoded.msig ? nacl.hash(algosdk.encodeObj(decoded.msig)) : null);
    if (!sig) throw new Error("No signature found");

    const keypair = deriveKeyFromSignature(sig);
    beaconKeypairRef.current = keypair;
    return keypair;
  }, [activeAddress, signTransactions]);

  const lookupWpk = useCallback(async (targetAddress: string): Promise<{ wpk: string; nfd?: string } | null> => {
    try {
      const url = `${MAINNET_ALGONODE_INDEXER}/v2/transactions?address=${BEACON_PROTOCOL_ADDRESS}&address-role=receiver&note-prefix=${BEACON_PREFIX_B64}&limit=100`;
      const res = await fetch(url);
      const data = await res.json();
      for (const tx of data.transactions || []) {
        if (tx.sender !== targetAddress) continue;
        const noteStr = new TextDecoder().decode(base64ToUint8(tx.note));
        const payload = parsePlaintextBeaconNote(noteStr);
        if (payload?.type === "announce" && payload.wpk) {
          return { wpk: payload.wpk, nfd: payload.nfd };
        }
      }
      return null;
    } catch { return null; }
  }, []);

  const checkAnnounceStatus = useCallback(async () => {
    if (!activeAddress) return;
    try {
      const url = `${MAINNET_ALGONODE_INDEXER}/v2/transactions?address=${BEACON_PROTOCOL_ADDRESS}&address-role=receiver&note-prefix=${BEACON_PREFIX_B64}&limit=100`;
      const res = await fetch(url);
      const data = await res.json();
      for (const tx of data.transactions || []) {
        if (tx.sender !== activeAddress) continue;
        const noteStr = new TextDecoder().decode(base64ToUint8(tx.note));
        const payload = parsePlaintextBeaconNote(noteStr);
        if (payload?.type === "announce") {
          setIsAnnounced(true);
          break;
        }
      }
    } catch { /* skip */ }
  }, [activeAddress]);

  useEffect(() => { checkAnnounceStatus(); }, [checkAnnounceStatus]);

  const sendFile = useCallback(async (file: File) => {
    if (!dcRef.current || dcRef.current.readyState !== "open") return;
    const CHUNK_SIZE = 16384;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const fileId = Math.random().toString(36).substring(7);
    
    // Metadata
    dcRef.current.send(JSON.stringify({
      type: "file-meta",
      fileId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      totalChunks,
      ts: Date.now()
    }));

    const reader = new FileReader();
    let offset = 0;
    
    reader.onload = async (e) => {
      if (!e.target?.result || !dcRef.current) return;

      // Backpressure: Wait for the data channel buffer to drain if needed
      while (dcRef.current && dcRef.current.bufferedAmount > 1_000_000) {
        await new Promise(r => setTimeout(r, 100));
      }

      const chunk = uint8ToBase64(new Uint8Array(e.target.result as ArrayBuffer));
      dcRef.current.send(JSON.stringify({
        type: "file-chunk",
        fileId,
        index: offset / CHUNK_SIZE,
        data: chunk
      }));
      
      offset += CHUNK_SIZE;
      if (offset < file.size) {
        readNext();
      } else {
        setMessages(prev => [...prev, { text: `Sent: ${file.name}`, sender: "me", timestamp: Date.now(), type: "text" }]);
      }
    };

    const readNext = () => {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      reader.readAsArrayBuffer(slice);
    };

    readNext();
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === "file") {
        const file = items[i].getAsFile();
        if (file) sendFile(file);
      }
    }
  }, [sendFile]);

  const handleAnnounce = useCallback(async () => {
    if (!activeAddress || !signTransactions || !algodClient) return;
    setAnnouncing(true);
    try {
      // 1. Get (or derive) the persistent identity keypair
      // This will prompt for "Identity Proof" if not cached. 
      // This MUST be an off-chain signature to keep the secretKey private.
      const keypair = await getBeaconKeypair();
      
      const nfdName = await getNfdDomain(activeAddress);
      const payload: BeaconNote = {
        proto: "BEACON/1",
        type: "announce",
        wpk: uint8ToBase64(keypair.publicKey),
        ts: Date.now(),
        nfd: nfdName || undefined,
      };
      
      const noteBytes = new TextEncoder().encode(`${BEACON_PREFIX}${btoa(JSON.stringify(payload))}`);
      const params = await algodClient.getTransactionParams().do();
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: activeAddress,
        to: BEACON_PROTOCOL_ADDRESS,
        amount: 0,
        note: noteBytes,
        suggestedParams: { ...params, fee: 1000, flatFee: true },
      });

      const signed = await signTransactions([algosdk.encodeUnsignedTransaction(txn)]);
      if (!signed?.[0]) throw new Error("Cancelled");

      await algodClient.sendRawTransaction(signed[0]).do();
      toast.success("Identity Published!");
      setIsAnnounced(true);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAnnouncing(false);
    }
  }, [activeAddress, signTransactions, algodClient, getBeaconKeypair]);

  // ═══════════════════════════════════════════════════════════════════
  //  WebRTC & Signaling
  // ═══════════════════════════════════════════════════════════════════

  const setupDataChannel = useCallback((channel: RTCDataChannel) => {
    dcRef.current = channel;
    const fileBuffers = new Map<string, { chunks: string[], meta: any }>();

    channel.onopen = () => {
      setPhase("chat");
      setIsConnected(true);
      setConnectionStatus("Connected");
      toast.success("Secure link established!");
    };
    channel.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "text") {
          setMessages((prev) => [...prev, { text: msg.text, sender: "peer", timestamp: msg.ts, type: "text" }]);
        } else if (msg.type === "file-meta") {
          fileBuffers.set(msg.fileId, { chunks: new Array(msg.totalChunks), meta: msg });
          setMessages(prev => [...prev, { text: `Receiving: ${msg.fileName}`, sender: "peer", timestamp: Date.now(), type: "text" }]);
        } else if (msg.type === "file-chunk") {
          const entry = fileBuffers.get(msg.fileId);
          if (entry) {
            entry.chunks[msg.index] = msg.data;
            if (entry.chunks.every(c => c !== undefined)) {
              const blob = new Blob(entry.chunks.map(c => base64ToUint8(c)) as any, { type: entry.meta.fileType });
              const url = URL.createObjectURL(blob);
              setMessages(prev => [...prev, { 
                text: `Received file: ${entry.meta.fileName}`, 
                sender: "peer", 
                timestamp: Date.now(), 
                type: "text",
                fileUrl: url
              }]);
              fileBuffers.delete(msg.fileId);
            }
          }
        }
      } catch { /* skip */ }
    };
    channel.onclose = () => goHome();
  }, [goHome]);

  const initiateChat = useCallback(async (contact: { address: string; wpk: string; nfd?: string }) => {
    if (!activeAddress || !signTransactions || !algodClient) return;
    try {
      setPeerAddress(contact.address);
      setPeerNfd(contact.nfd);
      setPhase("connecting");
      setConnectionStatus("Preparing handshake...");

      const keypair = await getBeaconKeypair();
      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      rtcRef.current = pc;

      const dc = pc.createDataChannel("beacon", { negotiated: true, id: 0 });
      setupDataChannel(dc);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      setConnectionStatus("Gathering networking paths...");
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("ICE gathering timed out")), 15_000);
        const done = () => { clearTimeout(timeout); resolve(); };
        if (pc.iceGatheringState === "complete") return done();
        pc.onicegatheringstatechange = () => pc.iceGatheringState === "complete" && done();
      });

      const sdp = pc.localDescription?.sdp;
      if (!sdp) throw new Error("Handshake failed");
      const compressedSdp = await compress(filterSdp(sdp));

      const params = await algodClient.getTransactionParams().do();
      const txns: algosdk.Transaction[] = [];

      const now = Date.now();
      const buildOfferTx = (sdpPart: string, part?: number, total?: number) => {
        const payload: BeaconNote = {
          proto: "BEACON/1",
          type: "offer",
          wpk: uint8ToBase64(keypair.publicKey),
          ts: now,
          exp: now + OFFER_EXPIRY_MS,
          sdp: sdpPart,
          part,
          total
        };
        const noteBytes = new TextEncoder().encode(encryptBeaconNote(payload, base64ToUint8(contact.wpk)));
        return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          from: activeAddress,
          to: BEACON_PROTOCOL_ADDRESS,
          amount: 0,
          note: noteBytes,
          suggestedParams: { ...params, fee: 1000, flatFee: true },
        });
      };

      const baseTx = buildOfferTx(compressedSdp);

      if (baseTx.note!.length > 800) {
        const totalParts = Math.ceil(baseTx.note!.length / 800);
        const charsPerPart = Math.ceil(compressedSdp.length / totalParts);
        for (let i = 0; i < totalParts; i++) {
          const start = i * charsPerPart;
          const partSdp = compressedSdp.slice(start, start + charsPerPart);
          txns.push(buildOfferTx(partSdp, i + 1, totalParts));
        }
        algosdk.assignGroupID(txns);
      } else {
        txns.push(baseTx);
      }

      setConnectionStatus(`Broadcasting offer (${txns.length} tx)...`);
      const signed = await signTransactions(txns.map(t => algosdk.encodeUnsignedTransaction(t)));
      if (!signed || signed.length !== txns.length) throw new Error("Cancelled");
      
      const validSigned = signed.filter((s): s is Uint8Array => s !== null);
      await algodClient.sendRawTransaction(validSigned).do();
      setConnectionStatus("Offer broadcast. Waiting for peer...");

      if (pollRef.current) clearInterval(pollRef.current);
      const answerParts = new Map<number, string>();
      pollRef.current = setInterval(async () => {
        try {
          const url = `${MAINNET_ALGONODE_INDEXER}/v2/transactions?address=${BEACON_PROTOCOL_ADDRESS}&address-role=receiver&note-prefix=${BEACON_PREFIX_B64}&limit=20`;
          const res = await fetch(url);
          const data = await res.json();
          for (const tx of data.transactions || []) {
            const noteStr = new TextDecoder().decode(base64ToUint8(tx.note));
            const decrypted = decryptBeaconNote(noteStr, keypair.secretKey);
            if (decrypted?.type === "answer" && tx.sender === contact.address) {
              if (decrypted.part && decrypted.total) {
                answerParts.set(decrypted.part, decrypted.sdp || "");
                if (answerParts.size < decrypted.total) continue;
                const fullSdp = Array.from({ length: decrypted.total }, (_, i) => answerParts.get(i + 1)).join("");
                const answerSdp = await decompress(fullSdp || "");
                await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
                clearInterval(pollRef.current!);
                setConnectionStatus("Finalizing connection...");
              } else if (decrypted.sdp) {
                clearInterval(pollRef.current!);
                setConnectionStatus("Finalizing connection...");
                const answerSdp = await decompress(decrypted.sdp);
                await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
              }
              break;
            }
          }
        } catch { /* poll error */ }
      }, POLL_INTERVAL_ACTIVE);
    } catch (err: any) {
      console.error("Offer Error:", err);
      toast.error(err.message || "Offer failed");
      goHome();
    }
  }, [activeAddress, signTransactions, algodClient, getBeaconKeypair, setupDataChannel, goHome]);

  const answerOffer = useCallback(async (offer: { fromAddress: string; wpk: string; ts: number; sdp?: string }) => {
    if (!activeAddress || !signTransactions || !algodClient || !offer.sdp) return;
    try {
      setPeerAddress(offer.fromAddress);
      setPhase("connecting");
      setConnectionStatus("Responding to handshake...");

      const keypair = await getBeaconKeypair();
      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      rtcRef.current = pc;

      const dc = pc.createDataChannel("beacon", { negotiated: true, id: 0 });
      setupDataChannel(dc);

      const offerSdp = await decompress(offer.sdp);
      await pc.setRemoteDescription({ type: "offer", sdp: offerSdp });

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      setConnectionStatus("Gathering paths...");
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("ICE gathering timed out")), 15_000);
        const done = () => { clearTimeout(timeout); resolve(); };
        if (pc.iceGatheringState === "complete") return done();
        pc.onicegatheringstatechange = () => pc.iceGatheringState === "complete" && done();
      });

      const sdp = pc.localDescription?.sdp;
      if (!sdp) throw new Error("Answer failed");
      const compressedSdp = await compress(filterSdp(sdp));

      const params = await algodClient.getTransactionParams().do();
      const txns: algosdk.Transaction[] = [];

      const buildAnswerTx = (sdpPart?: string, part?: number, total?: number) => {
        const payload: BeaconNote = {
          proto: "BEACON/1",
          type: "answer",
          wpk: uint8ToBase64(keypair.publicKey),
          ts: offer.ts, // Use offer's TS for consistency
          sdp: sdpPart,
          part,
          total
        };
        const noteBytes = new TextEncoder().encode(encryptBeaconNote(payload, base64ToUint8(offer.wpk)));
        return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          from: activeAddress,
          to: BEACON_PROTOCOL_ADDRESS,
          amount: 0,
          note: noteBytes,
          suggestedParams: { ...params, fee: 1000, flatFee: true },
        });
      };

      const baseTx = buildAnswerTx(compressedSdp);
      if (baseTx.note!.length > 800) {
        const totalParts = Math.ceil(baseTx.note!.length / 800);
        const charsPerPart = Math.ceil(compressedSdp.length / totalParts);
        for (let i = 0; i < totalParts; i++) {
          const start = i * charsPerPart;
          const partSdp = compressedSdp.slice(start, start + charsPerPart);
          txns.push(buildAnswerTx(partSdp, i + 1, totalParts));
        }
        algosdk.assignGroupID(txns);
      } else {
        txns.push(baseTx);
      }

      setConnectionStatus(`Responding (${txns.length} tx)...`);
      const signed = await signTransactions(txns.map(t => algosdk.encodeUnsignedTransaction(t)));
      if (!signed || signed.length !== txns.length) throw new Error("Cancelled");
      const validSigned = signed.filter((s): s is Uint8Array => s !== null);
      await algodClient.sendRawTransaction(validSigned).do();
      setConnectionStatus("Answer broadcast. Connecting...");
    } catch (err: any) {
      console.error("Answer Error:", err);
      toast.error(err.message || "Answer failed");
      goHome();
    }
  }, [activeAddress, signTransactions, algodClient, getBeaconKeypair, setupDataChannel, goHome]);

  // ═══════════════════════════════════════════════════════════════════
  //  Bonding & Contacts
  // ═══════════════════════════════════════════════════════════════════

  const scanBeacon = useCallback(async () => {
    if (!activeAddress) return;
    setScanning(true);
    try {
      const keypair = await getBeaconKeypair();
      const url = `${MAINNET_ALGONODE_INDEXER}/v2/transactions?address=${BEACON_PROTOCOL_ADDRESS}&address-role=receiver&note-prefix=${BEACON_PREFIX_B64}&limit=100`;
      const res = await fetch(url);
      const data = await res.json();
      
      const newRequests: BondRequest[] = [];
      let foundOffer = false;
      const offerParts = new Map<string, Map<number, string>>();

      for (const tx of data.transactions || []) {
        const noteStr = new TextDecoder().decode(base64ToUint8(tx.note));
        const payload = decryptBeaconNote(noteStr, keypair.secretKey);
        if (!payload) continue;

        if (payload.type === "bond-request" && tx.sender !== activeAddress) {
          if (payload.exp && payload.exp < Date.now()) continue;
          newRequests.push({ fromAddress: tx.sender, wpk: payload.wpk, nfd: payload.nfd, ts: payload.ts, round: tx["confirmed-round"] });
        } else if (payload.type === "bond-accept") {
          const current = getContacts(activeAddress);
          if (!current.some(c => c.address === tx.sender)) {
            const updated = [...current, { address: tx.sender, wpk: payload.wpk, nfd: payload.nfd, addedAt: Date.now() }];
            saveContacts(activeAddress, updated);
            setContacts(updated);
            toast.success(`New contact added: ${payload.nfd || shortenAddr(tx.sender)}`);
          }
        } else if (payload.type === "offer" && tx.sender !== activeAddress && !foundOffer) {
          if (payload.exp && payload.exp < Date.now()) continue;
          
          if (payload.part && payload.total) {
            const key = `${tx.sender}_${payload.ts}`;
            if (!offerParts.has(key)) offerParts.set(key, new Map());
            offerParts.get(key)!.set(payload.part, payload.sdp || "");
            
            if (offerParts.get(key)!.size === payload.total) {
              const fullSdp = Array.from({ length: payload.total }, (_, i) => offerParts.get(key)!.get(i + 1)).join("");
              setPendingOffer({ fromAddress: tx.sender, wpk: payload.wpk, ts: payload.ts, sdp: fullSdp, nfd: payload.nfd });
              foundOffer = true;
            }
          } else {
            setPendingOffer({ fromAddress: tx.sender, wpk: payload.wpk, ts: payload.ts, sdp: payload.sdp, nfd: payload.nfd });
            foundOffer = true;
          }
        }
      }
      setBondRequests(prev => {
        const combined = [...newRequests, ...prev];
        return combined.filter((v, i, a) => a.findIndex(t => t.fromAddress === v.fromAddress) === i);
      });
    } catch { toast.error("Scan failed"); }
    finally { setScanning(false); }
  }, [activeAddress, getBeaconKeypair]);

  const sendBondRequest = useCallback(async (target: string) => {
    if (!activeAddress || !signTransactions || !algodClient) return;
    setSendingBond(true);
    try {
      let addr = target.trim();
      if (addr.toLowerCase().endsWith(".algo")) {
        const nfdData = await fetch(`https://api.nf.domains/nfd/${addr.toLowerCase()}?view=tiny`).then(r => r.json());
        if (nfdData.depositAccount) addr = nfdData.depositAccount;
        else throw new Error("Could not resolve NFD");
      }
      const keypair = await getBeaconKeypair();
      const targetInfo = await lookupWpk(addr);
      if (!targetInfo) throw new Error("Recipient hasn't initialized BEACON");

      const payload: BeaconNote = {
        proto: "BEACON/1",
        type: "bond-request",
        wpk: uint8ToBase64(keypair.publicKey),
        ts: Date.now(),
        nfd: myNfd,
      };
      const noteBytes = new TextEncoder().encode(encryptBeaconNote(payload, base64ToUint8(targetInfo.wpk)));
      const params = await algodClient.getTransactionParams().do();
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: activeAddress,
        to: BEACON_PROTOCOL_ADDRESS,
        amount: 0,
        note: noteBytes,
        suggestedParams: { ...params, fee: 1000, flatFee: true },
      });
      const signed = await signTransactions([algosdk.encodeUnsignedTransaction(txn)]);
      if (!signed?.[0]) throw new Error("Cancelled");
      await algodClient.sendRawTransaction(signed[0]).do();
      toast.success("Bond request sent!");
      setPhase("home");
    } catch (err: any) { toast.error(err.message); }
    finally { setSendingBond(false); }
  }, [activeAddress, signTransactions, algodClient, getBeaconKeypair, lookupWpk, myNfd]);

  const acceptBond = useCallback(async (req: BondRequest) => {
    if (!activeAddress || !signTransactions || !algodClient) return;
    try {
      const keypair = await getBeaconKeypair();
      const payload: BeaconNote = {
        proto: "BEACON/1",
        type: "bond-accept",
        wpk: uint8ToBase64(keypair.publicKey),
        ts: Date.now(),
        nfd: myNfd,
      };
      const noteBytes = new TextEncoder().encode(encryptBeaconNote(payload, base64ToUint8(req.wpk)));
      const params = await algodClient.getTransactionParams().do();
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: activeAddress,
        to: BEACON_PROTOCOL_ADDRESS,
        amount: 0,
        note: noteBytes,
        suggestedParams: { ...params, fee: 1000, flatFee: true },
      });
      const signed = await signTransactions([algosdk.encodeUnsignedTransaction(txn)]);
      if (!signed?.[0]) throw new Error("Cancelled");
      await algodClient.sendRawTransaction(signed[0]).do();

      const updated = [...contacts, { address: req.fromAddress, wpk: req.wpk, nfd: req.nfd, addedAt: Date.now() }];
      saveContacts(activeAddress, updated);
      setContacts(updated);
      setBondRequests(prev => prev.filter(r => r.fromAddress !== req.fromAddress));
      toast.success("Bond established!");
    } catch (err: any) { toast.error(err.message); }
  }, [activeAddress, signTransactions, algodClient, getBeaconKeypair, contacts, myNfd]);

  const blockContact = useCallback((wpk: string, addr: string) => {
    const blocked = getBlockedWpks();
    if (!blocked.includes(wpk)) setBlockedWpks([...blocked, wpk]);
    if (activeAddress) {
      const updated = contacts.filter(c => c.wpk !== wpk);
      saveContacts(activeAddress, updated);
      setContacts(updated);
    }
    setBondRequests(prev => prev.filter(r => r.wpk !== wpk));
    toast.info(`Blocked ${shortenAddr(addr)}`);
  }, [activeAddress, contacts]);

  // ═══════════════════════════════════════════════════════════════════
  //  Chat Helpers
  // ═══════════════════════════════════════════════════════════════════

  const sendMessage = useCallback(() => {
    if (!messageInput.trim() || !dcRef.current) return;
    const msg = { type: "text", text: messageInput.trim(), ts: Date.now() };
    dcRef.current.send(JSON.stringify(msg));
    setMessages(prev => [...prev, { text: msg.text, sender: "me", timestamp: msg.ts, type: "text" }]);
    setMessageInput("");
  }, [messageInput]);

  const displayName = (addr: string, nfd?: string) => nfd || shortenAddr(addr);

  // ═══════════════════════════════════════════════════════════════════
  //  Render
  // ═══════════════════════════════════════════════════════════════════

  return (
    <div className="flex flex-col items-center justify-center w-full px-4 py-8 min-h-[80vh]">
      <div className="w-full max-w-2xl">
        {phase === "home" && (
          <div className="bg-[#111] rounded-2xl p-8 border border-[#222] shadow-2xl">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-primary-orange/20 flex items-center justify-center"><span className="text-xl">📡</span></div>
              <div>
                <h1 className="text-2xl font-bold text-white tracking-tight">BEACON Chat</h1>
                <p className="text-[10px] text-green-500 uppercase tracking-[0.2em] font-bold">Zero-Infrastructure Signaling — No Servers, No Brokers</p>
              </div>
            </div>

            {!activeAddress ? (
              <div className="p-6 rounded-xl bg-red-500/5 border border-red-500/20 text-center text-red-400 text-sm">Connect your wallet to continue</div>
            ) : (
              <>
                {!isAnnounced ? (
                  <div className="mb-6">
                    <div className="p-6 rounded-xl bg-primary-orange/5 border border-primary-orange/20 mb-4 text-xs">
                      <p className="text-primary-orange font-bold uppercase mb-2">Initialize Inbox</p>
                      <p className="text-gray-400 leading-relaxed">
                        To start, you must initialize your messaging identity. This broadcasts a one-time proof to the Algorand network.
                        Costs 0.001 ALGO. You may be prompted to confirm your identity before broadcasting.
                      </p>
                    </div>
                    <button onClick={handleAnnounce} disabled={announcing} className="w-full py-4 bg-primary-orange text-white rounded-xl font-bold transition-all disabled:opacity-40">{announcing ? "Broadcasting..." : "Initialize BEACON Inbox"}</button>
                  </div>
                ) : (
                  <div className="mb-6 flex items-center gap-2 px-4 py-3 rounded-xl bg-green-500/5 border border-green-500/20">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /><span className="text-green-400 text-xs font-bold uppercase tracking-widest">Inbox Active</span>
                    <span className="ml-auto text-gray-600 text-[10px] font-mono">{shortenAddr(activeAddress)}</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 mb-6">
                  <button onClick={scanBeacon} disabled={scanning || !isAnnounced} className="py-3 rounded-xl border border-primary-orange/30 text-primary-orange font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-30">
                    <MdRefresh size={18} className={scanning ? "animate-spin" : ""} /> {scanning ? "Scanning..." : "Scan Messages"}
                  </button>
                  <button onClick={() => setPhase("bond-requests")} className="relative py-3 rounded-xl bg-[#1a1a1a] border border-[#222] text-white font-bold flex items-center justify-center gap-2">
                    <MdPersonAdd size={18} /> Requests {bondRequests.length > 0 && <span className="absolute -top-2 -right-2 w-5 h-5 bg-primary-orange text-white text-[10px] flex items-center justify-center rounded-full border-2 border-[#111] animate-bounce">{bondRequests.length}</span>}
                  </button>
                </div>

                {pendingOffer && (
                  <div className="mb-6 p-4 rounded-xl bg-primary-orange/10 border border-primary-orange/30 animate-pulse">
                    <p className="text-primary-orange text-sm font-bold mb-1">Incoming Chat Request</p>
                    <p className="text-gray-400 text-xs mb-3">{displayName(pendingOffer.fromAddress, pendingOffer.nfd)} wants to connect</p>
                    <div className="flex gap-2">
                      <button onClick={() => answerOffer(pendingOffer)} className="flex-1 py-2 bg-primary-orange text-white rounded-lg text-sm font-bold">Accept</button>
                      <button onClick={() => setPendingOffer(null)} className="px-4 py-2 bg-[#222] text-gray-400 rounded-lg text-sm">Dismiss</button>
                    </div>
                  </div>
                )}

                <div className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">Contacts ({contacts.length})</p>
                    <button onClick={() => setPhase("contacts")} className="text-primary-orange text-xs font-bold">+ Add</button>
                  </div>
                  {contacts.length === 0 ? (
                    <div className="p-6 rounded-xl bg-[#1a1a1a] border border-[#222] text-center text-gray-500 text-sm">No contacts yet. Add one to start chatting!</div>
                  ) : (
                    <div className="space-y-2">
                      {contacts.map(c => (
                        <button key={c.address} onClick={() => initiateChat(c)} className="w-full flex items-center gap-3 p-4 rounded-xl bg-[#1a1a1a] border border-[#222] hover:border-primary-orange/30 transition-all text-left group">
                          <div className="w-10 h-10 rounded-full bg-primary-orange/10 flex items-center justify-center shrink-0"><MdPerson size={18} className="text-primary-orange" /></div>
                          <div className="flex-1 min-w-0"><p className="text-white text-sm font-medium truncate">{displayName(c.address, c.nfd)}</p><p className="text-gray-600 text-[10px] font-mono truncate">{c.address}</p></div>
                          <MdSend size={16} className="text-gray-600 group-hover:text-primary-orange transition-colors" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {phase === "bond-requests" && (
          <div className="bg-[#111] rounded-2xl p-8 border border-[#222] shadow-2xl">
            <div className="flex items-center justify-between mb-8"><h2 className="text-xl font-bold text-white">Contact Requests</h2><button onClick={() => setPhase("home")} className="text-gray-500 hover:text-white"><MdClose size={24} /></button></div>
            {bondRequests.length === 0 ? (
              <div className="p-12 text-center text-gray-500 text-sm">No pending requests</div>
            ) : (
              <div className="space-y-3">
                {bondRequests.map(req => (
                  <div key={req.fromAddress} className="flex items-center justify-between p-4 rounded-xl bg-[#1a1a1a] border border-[#222]">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary-orange/10 flex items-center justify-center"><MdPersonAdd size={18} className="text-primary-orange" /></div>
                      <div><p className="text-white text-sm font-medium">{displayName(req.fromAddress, req.nfd)}</p><p className="text-gray-600 text-[10px] font-mono">{shortenAddr(req.fromAddress)}</p></div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => acceptBond(req)} className="px-4 py-2 bg-primary-orange text-white rounded-lg text-xs font-bold">Accept</button>
                      <button onClick={() => blockContact(req.wpk, req.fromAddress)} className="px-3 py-2 bg-red-500/10 text-red-400 rounded-lg"><MdBlock size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {phase === "contacts" && (
          <div className="bg-[#111] rounded-2xl p-8 border border-[#222] shadow-2xl">
            <div className="flex items-center justify-between mb-8"><h2 className="text-xl font-bold text-white">Add Contact</h2><button onClick={() => setPhase("home")} className="text-gray-500 hover:text-white"><MdClose size={24} /></button></div>
            <div className="space-y-4">
              <div><label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest block mb-2">Wallet Address or .algo Name</label>
                <input type="text" value={newContactAddr} onChange={e => setNewContactAddr(e.target.value)} placeholder="ALGO... or name.algo" className="w-full py-3 px-4 bg-[#1a1a1a] text-white rounded-xl border border-[#222] outline-none focus:border-primary-orange transition-all" />
              </div>
              <p className="text-gray-500 text-xs">Bond requests cost 0.001 ALGO and establish a permanent encrypted link.</p>
              <button onClick={() => sendBondRequest(newContactAddr)} disabled={sendingBond || !newContactAddr.trim()} className="w-full py-4 bg-primary-orange text-white rounded-xl font-bold transition-all disabled:opacity-30">{sendingBond ? "Sending..." : "Send Bond Request"}</button>
            </div>
          </div>
        )}

        {phase === "connecting" && (
          <div className="bg-[#111] rounded-2xl p-8 border border-[#222] shadow-2xl text-center">
            <div className="animate-spin w-12 h-12 border-4 border-[#222] border-t-primary-orange rounded-full mx-auto mb-6" />
            <p className="text-white font-medium mb-2">{connectionStatus}</p>
            <button onClick={goHome} className="mt-6 text-red-400 text-sm font-bold uppercase tracking-widest">Cancel</button>
          </div>
        )}

        {phase === "chat" && (
          <div className="bg-[#111] rounded-2xl border border-[#222] shadow-2xl flex flex-col w-full overflow-hidden" style={{ height: "80vh" }}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#222] bg-[#0d0d0d]">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-primary-orange/10 flex items-center justify-center">
                    {isConnected ? <MdSignalWifi4Bar className="text-green-500" /> : <MdSignalWifiOff className="text-red-500" />}
                  </div>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#0d0d0d] ${isConnected ? "bg-green-500" : "bg-red-500"}`} />
                </div>
                <div>
                  <h2 className="text-white font-bold text-sm">{displayName(peerAddress, peerNfd)}</h2>
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                    {isConnected ? "Encrypted P2P" : "Disconnected"}
                  </p>
                </div>
              </div>
              <button onClick={goHome} className="text-gray-500 hover:text-white"><MdClose size={20} /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {messages.length === 0 && <div className="flex items-center justify-center h-full text-gray-600 text-sm">Start your serverless conversation</div>}
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.sender === "me" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${msg.sender === "me" ? "bg-primary-orange text-white rounded-br-md" : "bg-[#1a1a1a] text-gray-200 border border-[#222] rounded-bl-md"}`}>
                    <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{msg.text}</p>
                    {msg.fileUrl && (
                      <a href={msg.fileUrl} download={msg.text.split(": ")[1]} className="mt-2 block py-2 px-3 bg-black/20 rounded-lg text-[10px] font-bold text-primary-orange hover:bg-black/40 transition-all text-center">Download File</a>
                    )}
                    <p className="text-[9px] mt-1 opacity-40">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 border-t border-[#222] bg-[#0d0d0d] flex gap-2">
              <label className="w-12 h-12 bg-[#1a1a1a] text-gray-500 rounded-xl flex items-center justify-center border border-[#222] hover:text-white transition-all cursor-pointer">
                <MdAttachFile size={20} />
                <input type="file" className="hidden" onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) sendFile(file);
                  e.target.value = "";
                }} />
              </label>
              <input type="text" value={messageInput} onChange={e => setMessageInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendMessage()} onPaste={handlePaste} placeholder="Type a message..." className="flex-1 bg-[#1a1a1a] text-white rounded-xl px-4 py-3 border border-[#222] outline-none focus:border-primary-orange transition-all" />
              <button onClick={sendMessage} disabled={!messageInput.trim() || !isConnected} className="w-12 h-12 bg-primary-orange text-white rounded-xl flex items-center justify-center hover:scale-105 active:scale-95 transition-all disabled:opacity-40"><MdSend size={20} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
