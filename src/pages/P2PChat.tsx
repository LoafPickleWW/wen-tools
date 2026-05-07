import { useState, useEffect, useRef, useCallback } from "react";
import { useWallet } from "@txnlab/use-wallet-react";
import algosdk from "algosdk";
import { Peer, type DataConnection } from "peerjs";
import nacl from "tweetnacl";
import { toast } from "react-toastify";
import QRCode from "qrcode";
import { MdContentCopy, MdCheck, MdPerson, MdClose, MdImage, MdAttachFile } from "react-icons/md";
import { encryptDeadDrop, fetchNfdEncryptionKey, encryptBinaryDeadDrop, uint8ToBase64, base64ToUint8, decryptDeadDrop, decryptBinaryDeadDrop, deriveKeyFromSignature } from "../utils/deadDropCrypto";
import { pinJSONToCrust } from "../crust";
import { getNfdDomain } from "../utils";

// ── Browser-safe base64 helpers (no Buffer dependency) ──
// Helpers are now imported from deadDropCrypto

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

type Phase = "setup" | "waiting" | "connecting" | "chat" | "deaddrop";

export function P2PChat() {
  const { activeAddress, algodClient, signTransactions } = useWallet();
  const [phase, setPhase] = useState<Phase>("setup");
  const [requestId, setRequestId] = useState("");
  const [remoteRequestId, setRemoteRequestId] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [deepLinkUrl, setDeepLinkUrl] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [peerAddress, setPeerAddress] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("");
  const [pendingNonce, setPendingNonce] = useState("");
  
  // Dead Drop States
  const [ddRecipient, setDdRecipient] = useState("");
  const [ddMessage, setDdMessage] = useState("");
  const [ddFile, setDdFile] = useState<File | null>(null);
  const [ddLoading, setDdLoading] = useState(false);
  const [retrievedDrops, setRetrievedDrops] = useState<any[]>([]);
  

  const [myNfd, setMyNfd] = useState<{name?: string, avatar?: string} | null>(null);
  const [peerNfd, setPeerNfd] = useState<{name?: string, avatar?: string} | null>(null);
  const [showIdentityCard, setShowIdentityCard] = useState<{address: string, nfd?: any} | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  
  // Mutual Auth Proofs
  const [myInitProof, setMyInitProof] = useState<{txnB64: string, sigB64: string, address: string} | null>(null);

  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileChunksRef = useRef<Map<string, Uint8Array[]>>(new Map());

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Fetch NFD Info
  const fetchNfds = useCallback(async (myAddr: string, otherAddr: string) => {
    try {
      const res = await fetch(`https://api.nf.domains/nfd/lookup?address=${myAddr}&address=${otherAddr}&view=full`);
      const data = await res.json();
      
      // lookup?address=... returns { "ADDR": [ { ... }, { ... } ] }
      const myData = data[myAddr]?.[0];
      const otherData = data[otherAddr]?.[0];

      setMyNfd({ 
        name: myData?.name || undefined, 
        avatar: myData?.caasPortrait || myData?.properties?.userDefined?.avatar || myData?.caProperties?.avatar 
      });
      setPeerNfd({ 
        name: otherData?.name || undefined, 
        avatar: otherData?.caasPortrait || otherData?.properties?.userDefined?.avatar || otherData?.caProperties?.avatar 
      });
    } catch (err) {
      console.error("NFD Fetch error:", err);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (connRef.current) connRef.current.close();
      if (peerRef.current) peerRef.current.destroy();
    };
  }, []);

  const resetConnection = useCallback(() => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    if (connRef.current) connRef.current.close();
    if (peerRef.current) peerRef.current.destroy();
    connRef.current = null;
    peerRef.current = null;
    setPhase("setup");
    setIsConnected(false);
    setMessages([]);
    setQrDataUrl("");
    setDeepLinkUrl("");
    setPeerAddress("");
    setConnectionStatus("");
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const sendHandshake = useCallback(async (conn: DataConnection, nonce: string) => {
    if (!activeAddress || !signTransactions || !algodClient) {
      toast.error("Connect wallet to handshake");
      return;
    }
    
    setConnectionStatus("Signing handshake...");
    try {
      const suggestedParams = await algodClient.getTransactionParams().do();
      const noteStr = `Wen Tools P2P Auth:${nonce}:${Date.now()}`;
      const note = new TextEncoder().encode(noteStr);
      
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: activeAddress,
        to: activeAddress,
        amount: 0,
        note,
        suggestedParams: { ...suggestedParams, fee: 1000, flatFee: true },
      });

      const encodedTxn = algosdk.encodeUnsignedTransaction(txn);
      const signedResult = await signTransactions([encodedTxn]);
      
      if (!signedResult || !signedResult[0]) throw new Error("Cancelled");
      
      conn.send({
        type: "handshake",
        txnB64: uint8ToBase64(encodedTxn),
        sigB64: uint8ToBase64(signedResult[0] as Uint8Array),
        nonce,
        address: activeAddress // Explicitly send address to help NFD lookup
      });
    } catch (err: any) {
      console.error("Handshake sign failed:", err);
      toast.error("Handshake failed");
      resetConnection();
    }
  }, [activeAddress, signTransactions, algodClient, resetConnection]);

  const startHeartbeat = useCallback(() => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      if (connRef.current?.open) {
        connRef.current.send({ type: "heartbeat" });
      }
    }, 15_000);
  }, []);

  const handleConnection = useCallback((conn: DataConnection) => {
    connRef.current = conn;
    const role = (conn as any)._role as "offerer" | "joiner";
    
    conn.on("open", () => {
      if (role === "offerer") {
        const nonce = (conn as any)._challengeNonce as string;
        // Host sends challenge AND their own initial proof immediately
        conn.send({ 
          type: "challenge", 
          nonce,
          hostProof: myInitProof 
        });
        setConnectionStatus("Challenge sent. Waiting for peer...");
      } else {
        setConnectionStatus("Connected. Waiting for host identity...");
      }
    });

    conn.on("data", (data: any) => {
      if (!data) return;

      if (data.type === "challenge" && role === "joiner") {
        setPendingNonce(data.nonce);
        
        // Verify host's identity if provided
        if (data.hostProof) {
          try {
            const { txnB64, sigB64, address } = data.hostProof;
            const unsignedBytes = base64ToUint8(txnB64);
            const signedBytes = base64ToUint8(sigB64);
            const signedTxn = algosdk.decodeSignedTransaction(signedBytes);
            const txn = signedTxn.txn;
            const accountAddr = algosdk.encodeAddress(txn.from.publicKey);
            const signerKey = signedTxn.sgnr ? signedTxn.sgnr : txn.from.publicKey;
            
            const rawTxn = algosdk.decodeUnsignedTransaction(unsignedBytes);
            const isValid = nacl.sign.detached.verify(rawTxn.bytesToSign(), signedTxn.sig!, signerKey);
            
            if (isValid && accountAddr === address) {
              setPeerAddress(accountAddr);
              if (activeAddress) fetchNfds(activeAddress, accountAddr);
            }
          } catch (e) { console.error("Host identity verify failed:", e); }
        }

        setConnectionStatus("Identity verification required");
        return;
      }
      
      if (data.type === "handshake") {
        try {
          const { txnB64, sigB64, nonce } = data;
          const unsignedBytes = base64ToUint8(txnB64);
          const signedBytes = base64ToUint8(sigB64);
          const signedTxn = algosdk.decodeSignedTransaction(signedBytes);
          const txn = signedTxn.txn;

          if (!signedTxn.sig) throw new Error("No signature found");

          const noteBytes = txn.note;
          const noteStr = noteBytes ? new TextDecoder().decode(noteBytes) : "";
          if (!noteStr.includes(nonce)) throw new Error("Invalid nonce");

          const accountAddr = algosdk.encodeAddress(txn.from.publicKey);
          const signerKey = signedTxn.sgnr ? signedTxn.sgnr : txn.from.publicKey;
          
          const rawTxn = algosdk.decodeUnsignedTransaction(unsignedBytes);
          const bytesToVerify = rawTxn.bytesToSign();

          const isValid = nacl.sign.detached.verify(bytesToVerify, signedTxn.sig, signerKey);
          
          if (isValid) {
            setPeerAddress(accountAddr); // Use account address for identity
            
            if (role === "offerer") {
              // Offerer already authed at start, just finish up
              setPhase("chat");
              setIsConnected(true);
              setConnectionStatus("Connected");
              if (activeAddress) fetchNfds(activeAddress, accountAddr);
              conn.send({ type: "handshake-success", address: activeAddress });
              toast.success("Peer identity verified!");
              startHeartbeat();
            } else {
              // Joiner side receiving host's handshake (if mutual)
              setPhase("chat");
              setIsConnected(true);
              setConnectionStatus("Connected");
              if (activeAddress) fetchNfds(activeAddress, accountAddr);
              conn.send({ type: "handshake-success", address: activeAddress });
              toast.success("Mutual identity verified!");
              startHeartbeat();
            }
          } else {
            throw new Error("Invalid signature");
          }
        } catch {
          toast.error("Handshake failed");
          conn.close();
        }
        return;
      }

      if (data.type === "handshake-success") {
        setPeerAddress(data.address);
        if (activeAddress) fetchNfds(activeAddress, data.address);
        setPhase("chat");
        setIsConnected(true);
        setConnectionStatus("Connected");
        toast.success("P2P connection established!");
        startHeartbeat();
        return;
      }

      if (data.type === "heartbeat") return;
      
      if (data.type === "file-meta") {
        fileChunksRef.current.set(data.fileId, []);
        setMessages((prev) => [...prev, { text: `📎 Receiving file: ${data.fileName} (${formatFileSize(data.fileSize)})`, sender: "peer", timestamp: Date.now(), type: "file-meta", fileName: data.fileName, fileSize: data.fileSize, fileType: data.fileType, fileId: data.fileId }]);
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
          const blob = new Blob(chunks.map(c => new Uint8Array(c)) as BlobPart[], { type: data.fileType });
          const url = URL.createObjectURL(blob);
          setMessages((prev) => [...prev, { text: `📥 File received: ${data.fileName}`, sender: "peer", timestamp: Date.now(), type: "file-complete", fileName: data.fileName, fileId: data.fileId, fileType: data.fileType, fileUrl: url }]);
          fileChunksRef.current.delete(data.fileId);
        }
        return;
      }

      setMessages((prev) => [...prev, { text: data.text || "Message received", sender: "peer", timestamp: Date.now(), type: "text" }]);
    });

    conn.on("close", () => {
      setIsConnected(false);
      resetConnection();
    });
  }, [resetConnection, startHeartbeat, activeAddress, fetchNfds, myInitProof]);


  const startOfferSession = useCallback(async () => {
    if (!activeAddress || !signTransactions || !algodClient) {
      toast.error("Please connect your wallet first.");
      return;
    }
    
    try {
      setConnectionStatus("Verifying Host Identity...");
      
      // Force a signature BEFORE initializing the session
      const suggestedParams = await algodClient.getTransactionParams().do();
      const initTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: activeAddress,
        to: activeAddress,
        amount: 0,
        note: new TextEncoder().encode(`Wen Tools P2P Session Init:${Date.now()}`),
        suggestedParams: { ...suggestedParams, fee: 1000, flatFee: true },
      });

      const signedInit = await signTransactions([algosdk.encodeUnsignedTransaction(initTxn)]);
      if (!signedInit || !signedInit[0]) {
        toast.error("Session initialization cancelled.");
        return;
      }

      setMyInitProof({
        txnB64: uint8ToBase64(algosdk.encodeUnsignedTransaction(initTxn)),
        sigB64: uint8ToBase64(signedInit[0] as Uint8Array),
        address: activeAddress
      });

      setPhase("waiting");
      setConnectionStatus("Initializing P2P Engine...");
      
      const iceServers: any[] = [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ];
      const turnUser = import.meta.env.VITE_TURN_USERNAME;
      const turnPass = import.meta.env.VITE_TURN_CREDENTIAL;
      if (turnUser && turnPass) {
        iceServers.push(
          { urls: "turn:a.relay.metered.ca:80", username: turnUser, credential: turnPass },
          { urls: "turn:a.relay.metered.ca:443", username: turnUser, credential: turnPass },
          { urls: "turn:a.relay.metered.ca:443?transport=tcp", username: turnUser, credential: turnPass }
        );
      }

      const peer = new Peer({ config: { iceServers } });
      peerRef.current = peer;

      peer.on("open", async (id) => {
        setRequestId(id);
        const baseUrl = window.location.href.split("?")[0];
        const webShareUrl = `${baseUrl}?session=${id}`;
        setDeepLinkUrl(webShareUrl);

        try {
          const dataUrl = await QRCode.toDataURL(webShareUrl, {
            width: 256,
            margin: 2,
            color: { dark: "#f57b14", light: "#010002" },
          });
          setQrDataUrl(dataUrl);
        } catch (err) { console.error(err); }

        setConnectionStatus("Waiting for peer...");
        toast.success("Identity verified. Session live!");
      });

      peer.on("connection", (conn) => {
        (conn as any)._challengeNonce = crypto.randomUUID();
        (conn as any)._role = "offerer";
        handleConnection(conn);
      });

      peer.on("error", (err) => {
        console.error("Peer error:", err);
        toast.error("Peer error: " + err.type);
        resetConnection();
      });

    } catch (err: any) {
      console.error("Start session failed:", err);
      toast.error("Failed to start session");
      resetConnection();
    }
  }, [handleConnection, resetConnection, activeAddress, signTransactions, algodClient]);

  const joinSession = useCallback(async (overrideSessionId?: any) => {
    const targetSessionId = overrideSessionId || remoteRequestId;

    if (!targetSessionId?.trim()) {
      toast.error("Please enter a session ID");
      return;
    }

    if (!activeAddress) {
      toast.error("Please connect your wallet first.");
      return;
    }

    try {
      setPhase("connecting");
      setConnectionStatus("Connecting to peer...");
      
      const iceServers: any[] = [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ];
      const turnUser = import.meta.env.VITE_TURN_USERNAME;
      const turnPass = import.meta.env.VITE_TURN_CREDENTIAL;
      if (turnUser && turnPass) {
        iceServers.push(
          { urls: "turn:a.relay.metered.ca:80", username: turnUser, credential: turnPass },
          { urls: "turn:a.relay.metered.ca:443", username: turnUser, credential: turnPass },
          { urls: "turn:a.relay.metered.ca:443?transport=tcp", username: turnUser, credential: turnPass }
        );
      }

      const peer = new Peer({ config: { iceServers } });
      peerRef.current = peer;

      peer.on("open", () => {
        const conn = peer.connect(targetSessionId.trim(), {
          reliable: true,
        });
        (conn as any)._role = "joiner";
        handleConnection(conn);
      });

      peer.on("error", (err) => {
        console.error("Peer error:", err);
        toast.error("Connection failed: " + err.type);
        resetConnection();
      });

    } catch (err: any) {
      console.error("Join session failed:", err);
      toast.error("Failed to join session");
      resetConnection();
    }
  }, [remoteRequestId, activeAddress, handleConnection, resetConnection]);

  const hasAutoJoined = useRef(false);

  // Auto-read session param from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const session = params.get("session");
    if (session && !remoteRequestId && !hasAutoJoined.current && phase === "setup") {
      setRemoteRequestId(session);
      if (activeAddress) {
        hasAutoJoined.current = true;
        joinSession(session);
      }
    }
  }, [joinSession, activeAddress, remoteRequestId, phase]);

  const sendMessage = useCallback(() => {
    if (!inputText.trim() || !connRef.current?.open) return;
    connRef.current.send({ type: "text", text: inputText.trim() });
    setMessages((prev) => [...prev, { text: inputText.trim(), sender: "me", timestamp: Date.now(), type: "text" }]);
    setInputText("");
  }, [inputText]);

  const sendFile = useCallback(async (file: File) => {
    if (!connRef.current?.open) return;
    const fileId = crypto.randomUUID();
    connRef.current.send({ type: "file-meta", fileId, fileName: file.name, fileSize: file.size, fileType: file.type });
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    setMessages((prev) => [...prev, { text: `📎 Sent file: ${file.name}`, sender: "me", timestamp: Date.now(), type: "file-complete", fileName: file.name, fileSize: file.size, fileType: file.type, fileId, fileUrl: URL.createObjectURL(file) }]);
    for (let offset = 0; offset < data.length; offset += 16384) {
      connRef.current.send({ type: "file-chunk", fileId, data: data.slice(offset, offset + 16384) });
      await new Promise((r) => setTimeout(r, 10));
    }
    connRef.current.send({ type: "file-complete", fileId, fileName: file.name, fileType: file.type });
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const file = e.clipboardData.files[0];
    if (file?.type.startsWith("image/")) sendFile(file);
  }, [sendFile]);

  const shortenAddr = (addr: string) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";

  return (
    <div className="flex flex-col items-center justify-center w-full px-4 py-8 min-h-[80vh]">
      <div className="w-full max-w-2xl">
        {phase === "setup" && (
          <div className="bg-[#1a1a1a] rounded-2xl p-8 border border-[#333] shadow-2xl">
            <h1 className="text-3xl font-bold text-white mb-8 text-center">🔐 P2P Encrypted Chat</h1>
            <div className="p-6 rounded-xl bg-primary-orange/5 border border-primary-orange/20 mb-6 text-center">
              <p className="text-primary-orange text-sm font-bold mb-2 uppercase tracking-widest">Host Identity Required</p>
              <p className="text-gray-400 text-xs leading-relaxed">
                To start a session, you must first verify your wallet identity. 
                This ensures your peers know exactly who they are connecting with.
              </p>
            </div>
            <button onClick={startOfferSession} className="w-full py-4 bg-primary-orange text-white rounded-xl mb-4 font-bold shadow-lg shadow-primary-orange/20 hover:scale-[1.02] active:scale-[0.98] transition-all">
              Verify & Create Session
            </button>
            <div className="flex flex-col gap-3">
              <input type="text" value={remoteRequestId} onChange={(e) => setRemoteRequestId(e.target.value)} placeholder="Session ID..." className="w-full py-3 px-4 bg-[#242424] text-white rounded-xl border border-[#333]" />
              <button onClick={() => joinSession()} className="w-full py-3 bg-[#646cff] text-white rounded-xl font-bold">Join Session</button>
            </div>

            <div className="mt-8 pt-8 border-t border-[#333]">
              <p className="text-gray-500 text-[10px] font-black uppercase tracking-widest mb-4 text-center">Asynchronous Tools</p>
              <button 
                onClick={() => setPhase("deaddrop")}
                className="w-full py-4 rounded-xl border border-primary-orange/30 text-primary-orange font-bold hover:bg-primary-orange/5 transition-all flex items-center justify-center gap-2"
              >
                <span>📦</span> Create or Pick Up Dead Drop
              </button>
            </div>
          </div>
        )}

        {/* ─── DEAD DROP PHASE ─── */}
        {phase === "deaddrop" && (
          <div className="bg-[#1a1a1a] rounded-2xl p-8 border border-[#333] shadow-2xl">
            <div className="flex items-center justify-between mb-8">
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                <span className="text-primary-orange">📦</span> Dead Drop Relay
              </h1>
              <button onClick={() => setPhase("setup")} className="text-gray-500 hover:text-white transition-colors">
                <MdClose size={24} />
              </button>
            </div>

            <div className="space-y-6">
              {/* Drop Form */}
              <div className="p-6 rounded-xl bg-white/5 border border-white/10">
                <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-widest">Leave a Drop</h3>
                <div className="space-y-4">
                  <input 
                    type="text" 
                    value={ddRecipient}
                    onChange={(e) => setDdRecipient(e.target.value)}
                    placeholder="Recipient Wallet or .algo name"
                    className="w-full py-3 px-4 bg-[#242424] text-white rounded-xl border border-[#333] outline-none focus:border-primary-orange transition-all"
                  />
                  <div className="flex items-center gap-2">
                    <textarea 
                      value={ddMessage}
                      onChange={(e) => setDdMessage(e.target.value)}
                      placeholder={ddFile ? `File attached: ${ddFile.name}` : "Your encrypted message..."}
                      className="flex-1 py-3 px-4 bg-[#242424] text-white rounded-xl border border-[#333] outline-none focus:border-primary-orange transition-all min-h-[60px]"
                    />
                    <label className="p-4 bg-[#242424] hover:bg-[#333] text-gray-400 rounded-xl border border-[#333] cursor-pointer transition-all">
                      <MdAttachFile size={20} />
                      <input 
                        type="file" 
                        className="hidden" 
                        onChange={(e) => setDdFile(e.target.files?.[0] || null)} 
                      />
                    </label>
                  </div>
                  {ddFile && (
                    <div className="flex items-center justify-between px-4 py-2 bg-primary-orange/10 border border-primary-orange/20 rounded-lg text-[10px]">
                      <span className="text-primary-orange font-bold truncate">{ddFile.name} ({(ddFile.size / 1024).toFixed(1)} KB)</span>
                      <button onClick={() => setDdFile(null)} className="text-gray-500 hover:text-white"><MdClose size={14} /></button>
                    </div>
                  )}
                  <button 
                    disabled={ddLoading || !ddRecipient || (!ddMessage && !ddFile)}
                    onClick={async () => {
                      if (!activeAddress) {
                        toast.error("Please connect your wallet");
                        return;
                      }
                      setDdLoading(true);
                      try {
                        let targetAddr = ddRecipient;

                        // 1. Resolve NFD to raw address if needed
                        if (ddRecipient.toLowerCase().endsWith(".algo")) {
                          const nfdData = await fetch(`https://api.nf.domains/nfd/${ddRecipient.toLowerCase()}?view=tiny`).then(r => r.json());
                          if (nfdData.depositAccount) {
                            targetAddr = nfdData.depositAccount;
                          } else {
                            throw new Error("Could not resolve NFD");
                          }
                        }

                        // 2. Fetch recipient's registered X25519 public key from relay
                        let recipientPubKey: string | null = null;
                        try {
                          const pkRes = await fetch(`/api/deaddrop?address=${targetAddr}&getPubKey=true`);
                          if (pkRes.ok) {
                            const pkData = await pkRes.json();
                            recipientPubKey = pkData.pubKey || null;
                          }
                        } catch { /* relay unreachable */ }

                        // Also check NFD encryption_key as fallback
                        if (!recipientPubKey && ddRecipient.toLowerCase().endsWith(".algo")) {
                          recipientPubKey = await fetchNfdEncryptionKey(ddRecipient);
                        }

                        if (!recipientPubKey) {
                          throw new Error("Recipient has not initialized their Dead Drop mailbox yet. Ask them to open the P2P Chat page and click 'Open My Mailbox'.");
                        }

                        console.log(`📦 [Dead Drop] Initializing drop for: ${ddRecipient}`);
                        console.log(`📍 [Dead Drop] Target Address: ${targetAddr}`);
                        console.log(`🔑 [Dead Drop] Recipient PubKey: ${recipientPubKey}`);
                        
                        let payload: any;
                        
                        if (ddFile) {
                          const reader = new FileReader();
                          const fileData = await new Promise<Uint8Array>((resolve) => {
                            reader.onload = (e) => resolve(new Uint8Array(e.target?.result as ArrayBuffer));
                            reader.readAsArrayBuffer(ddFile);
                          });

                          // 3. Encrypt File locally using recipient's X25519 key
                          const encryptedFile = await encryptBinaryDeadDrop(fileData, targetAddr, recipientPubKey);
                          
                          // 4. Push Encrypted Payload to IPFS (Crust)
                          const authBasic = localStorage.getItem("authBasic");
                          const cid = await pinJSONToCrust(authBasic, JSON.stringify(encryptedFile));
                          
                          payload = {
                            type: "file",
                            cid,
                            fileName: ddFile.name,
                            fileSize: ddFile.size,
                            fileType: ddFile.type,
                            recipient: targetAddr
                          };
                        } else {
                          // Standard text drop — encrypt with recipient's X25519 key
                          const encrypted = await encryptDeadDrop(ddMessage, targetAddr, recipientPubKey);
                          payload = { ...encrypted, type: "text", recipient: targetAddr };
                        }
                        
                        // 4. Upload Metadata to Relay
                        const response = await fetch("/api/deaddrop", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(payload)
                        });

                        if (!response.ok) throw new Error("Relay storage failed");
                        
                        toast.success("Dead Drop deployed successfully!");
                        setDdMessage("");
                        setDdFile(null);
                      } catch (err: any) {
                        toast.error(err.message || "Failed to create drop");
                      } finally {
                        setDdLoading(false);
                      }
                    }}
                    className="w-full py-4 bg-primary-orange text-white rounded-xl font-bold disabled:opacity-30"
                  >
                    {ddLoading ? "Encrypting & Deploying..." : "Initialize Dead Drop"}
                  </button>
                </div>
              </div>

              {/* Pickup Area */}
              <div className="p-6 rounded-xl bg-primary-orange/5 border border-primary-orange/20">
                <h3 className="text-sm font-bold text-primary-orange mb-4 uppercase tracking-widest">Pick Up a Drop</h3>
                
                {retrievedDrops.length > 0 ? (
                  <div className="space-y-4 mb-6 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                    {retrievedDrops.map((drop, idx) => (
                      <div key={idx} className="p-4 bg-black/40 rounded-xl border border-primary-orange/30 group animate-in fade-in slide-in-from-bottom-2">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-[10px] text-primary-orange font-black uppercase tracking-widest">
                            {drop.type === 'file' ? '📁 Secure File' : '📝 Encrypted Text'}
                          </p>
                          {drop.fileSize && (
                            <span className="text-[9px] text-gray-500">{(drop.fileSize / 1024).toFixed(1)} KB</span>
                          )}
                        </div>
                        
                        {drop.isFile && drop.fileType?.startsWith("image/") && (
                          <div className="mb-3 rounded-lg overflow-hidden border border-white/5">
                            <img src={drop.fileUrl || "/placeholder-image.png"} alt={drop.fileName} className="w-full h-auto object-cover max-h-[200px]" />
                          </div>
                        )}

                        {drop.isFile && drop.fileType?.startsWith("video/") && (
                          <div className="mb-3 rounded-lg overflow-hidden border border-white/5">
                            <video src={drop.fileUrl || ""} controls className="w-full max-h-[200px]" />
                          </div>
                        )}

                        <p className="text-white text-sm whitespace-pre-wrap break-words leading-relaxed">
                          {drop.decrypted}
                        </p>
                        
                        {drop.isFile && !drop.fileUrl && (
                          <button 
                            className="mt-3 w-full py-2 bg-white/5 hover:bg-white/10 text-[10px] text-gray-400 font-bold rounded-lg transition-all"
                            onClick={() => toast.info("Decryption logic for offline payloads is being finalized.")}
                          >
                            DECRYPT & VIEW {drop.fileName?.toUpperCase()}
                          </button>
                        )}
                      </div>
                    ))}
                    <button onClick={() => setRetrievedDrops([])} className="w-full py-2 text-[10px] text-gray-500 uppercase font-black hover:text-white transition-colors">Clear Retrieved Drops</button>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 mb-6">
                    Sign a challenge to check if anyone has left an encrypted payload for your wallet. 
                    Drops self-destruct immediately after retrieval.
                  </p>
                )}

                <button 
                  disabled={ddLoading}
                  onClick={async () => {
                    if (!activeAddress) {
                      toast.error("Please connect your wallet");
                      return;
                    }
                    
                    setDdLoading(true);
                    try {
                      // 1. Sign Identity Proof
                      const nonce = crypto.randomUUID();
                      const pickupTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
                        from: activeAddress,
                        to: activeAddress,
                        amount: 0,
                        note: new TextEncoder().encode(`Dead Drop Pickup: ${nonce}`),
                        suggestedParams: await algodClient.getTransactionParams().do(),
                      });

                      const signed = await signTransactions([algosdk.encodeUnsignedTransaction(pickupTxn)]);
                      if (!signed || !signed[0]) return;

                      const sigB64 = uint8ToBase64((algosdk.decodeSignedTransaction(signed[0])).sig!);

                      // 2. Auto-initialize mailbox if needed (transparent to user)
                      let savedSk = localStorage.getItem(`wen_dd_sk_${activeAddress}`);
                      if (!savedSk) {
                        // Check if relay already has a key (registered from another device)
                        let relayHasKey = false;
                        try {
                          const pkCheck = await fetch(`/api/deaddrop?address=${activeAddress}&getPubKey=true`);
                          if (pkCheck.ok) {
                            const pkData = await pkCheck.json();
                            relayHasKey = !!pkData.pubKey;
                          }
                        } catch { /* relay unreachable */ }

                        if (relayHasKey) {
                          const reinit = window.confirm(
                            "⚠️ Your Dead Drop mailbox was set up on a different device.\n\n" +
                            "Your encryption key is stored locally in your browser — it doesn't travel between devices. " +
                            "To use Dead Drop here, we'll need to create a new key.\n\n" +
                            "What this means:\n" +
                            "• Any UNREAD messages sent to your old key will become unreadable\n" +
                            "• New messages will work perfectly on this device\n" +
                            "• Your old device will no longer be able to decrypt new messages\n\n" +
                            "Continue with new key?"
                          );
                          if (!reinit) {
                            setDdLoading(false);
                            return;
                          }
                        }

                        console.log("🔑 [Dead Drop] Initializing mailbox...");
                        const keyPair = deriveKeyFromSignature(signed[0]);
                        
                        // Register public key on relay
                        await fetch("/api/deaddrop", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ 
                            recipient: activeAddress,
                            address: activeAddress, 
                            registerPubKey: uint8ToBase64(keyPair.publicKey)
                          })
                        });
                        
                        savedSk = uint8ToBase64(keyPair.secretKey);
                        localStorage.setItem(`wen_dd_sk_${activeAddress}`, savedSk);
                        console.log("✅ [Dead Drop] Mailbox initialized!");
                      }
                      const secretKey = base64ToUint8(savedSk);

                      // 3. Fetch from Relay (Check both raw address and NFD name)
                      const nfdName = await getNfdDomain(activeAddress);
                      const scanTargets = [activeAddress];
                      if (nfdName) scanTargets.push(nfdName);

                      console.log("🔍 [Dead Drop] Starting exhaustive scan...");
                      console.log(`👤 [Dead Drop] Identities to check: ${scanTargets.join(", ")}`);
                      toast.info(`Scanning relay for ${scanTargets.join(" / ")}...`);

                      const allDrops: any[] = [];
                      for (const target of scanTargets) {
                        const query = new URLSearchParams({
                          address: target,
                          sig: sigB64,
                          txn: uint8ToBase64(signed[0])
                        }).toString();

                        console.log(`📡 [Dead Drop] Querying relay for: ${target}`);
                        const res = await fetch(`/api/deaddrop?${query}`);
                        if (res.ok) {
                          const data = await res.json();
                          console.log(`📥 [Dead Drop] Relay response for ${target}:`, data);
                          if (data.drops) allDrops.push(...data.drops);
                        } else {
                          console.error(`❌ [Dead Drop] Relay error for ${target}:`, await res.text());
                        }
                      }

                      if (allDrops.length > 0) {
                        toast.success(`Found ${allDrops.length} drop(s)!`);
                        
                        // 4. Process & Decrypt drops
                        const processed = await Promise.all(allDrops.map(async (drop: any) => {
                          try {
                            if (drop.type === "file") {
                              const decryptedBytes = decryptBinaryDeadDrop(drop.ciphertext, drop.nonce, drop.ephemeralPk, secretKey);
                              const blob = new Blob([decryptedBytes as BlobPart], { type: drop.fileType || "application/octet-stream" });
                              const url = URL.createObjectURL(blob);
                              
                              return { 
                                ...drop, 
                                decrypted: `File: ${drop.fileName}`,
                                isFile: true,
                                fileUrl: url
                              };
                            }

                            // Text Decryption
                            const text = decryptDeadDrop(drop.ciphertext, drop.nonce, drop.ephemeralPk, secretKey);
                            return { ...drop, decrypted: text };

                          } catch (err) { 
                            console.error("Decryption failed:", err);
                            return { ...drop, decrypted: "Decryption failed. This drop may have been sent before your mailbox was initialized." }; 
                          }
                        }));
                        setRetrievedDrops(processed);
                      } else {
                        toast.info("No drops found for your wallet.");
                      }
                      
                    } catch {
                      toast.error("Authentication failed");
                    } finally {
                      setDdLoading(false);
                    }
                  }}
                  className="w-full py-4 rounded-xl border-2 border-primary-orange text-primary-orange font-bold hover:bg-primary-orange/10 transition-all disabled:opacity-30"
                >
                  {ddLoading ? "Verifying..." : "Scan Relay for My Drops"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─── WAITING PHASE (Offer side) ─── */}
        {phase === "waiting" && (
          <div className="bg-[#1a1a1a] rounded-2xl p-8 border border-[#333] shadow-2xl text-center">
            <div className="mb-6">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-orange/10 text-primary-orange text-sm mb-4">
                <span className="w-2 h-2 rounded-full bg-primary-orange animate-pulse" />
                {connectionStatus}
              </div>
            </div>

            {qrDataUrl && (
              <div className="mb-6 flex flex-col items-center">
                <p className="text-gray-400 text-sm mb-3">
                  📱 Scan to join the chat:
                </p>
                <div className="p-4 rounded-2xl bg-[#0a0a0a] border border-[#222] inline-block">
                  <img src={qrDataUrl} alt="Session QR" className="w-64 h-64 rounded-lg" />
                </div>
              </div>
            )}

            <div className="flex items-center gap-4 mb-6">
              <div className="flex-1 h-px bg-[#333]" />
              <span className="text-gray-500 text-sm">OR</span>
              <div className="flex-1 h-px bg-[#333]" />
            </div>

            <div className="mb-6">
              <p className="text-gray-400 text-sm mb-2">🌐 Share this link for browser-based join:</p>
              <div className="flex items-center gap-2 bg-[#0a0a0a] rounded-xl p-3 border border-[#222]">
                <code className="flex-1 text-primary-orange text-[10px] break-all text-left font-mono">
                  {deepLinkUrl}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(deepLinkUrl);
                    toast.success("Link copied!");
                  }}
                  className="px-4 py-2 rounded-lg bg-primary-orange/20 text-primary-orange
                    hover:bg-primary-orange/30 transition-colors text-sm font-medium shrink-0"
                >
                  Copy
                </button>
              </div>
            </div>

            <p className="text-gray-500 text-[10px] mb-4 font-mono">
              Session ID: <code className="text-gray-400">{requestId}</code>
            </p>

            <button
              onClick={resetConnection}
              className="text-red-400 hover:text-red-300 text-sm transition-colors font-bold uppercase tracking-widest"
            >
              Cancel Session
            </button>
          </div>
        )}

        {/* ─── CONNECTING PHASE ─── */}
        {phase === "connecting" && (
          <div className="bg-[#1a1a1a] rounded-2xl p-8 border border-[#333] shadow-2xl text-center">
            {pendingNonce ? (
              <>
                <div className="w-16 h-16 bg-primary-orange/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl">🔐</span>
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Verify Your Identity</h3>
                <p className="text-gray-400 text-sm mb-6">
                  To ensure a secure connection, please sign a zero-cost transaction to verify your wallet ownership.
                </p>
                <button
                  onClick={() => {
                    if (connRef.current && pendingNonce) {
                      sendHandshake(connRef.current, pendingNonce);
                    }
                  }}
                  className="w-full py-4 px-6 rounded-xl font-bold text-white
                    bg-gradient-to-r from-primary-orange to-[#e06b10]
                    hover:from-[#e06b10] hover:to-primary-orange
                    transition-all duration-300 shadow-lg hover:shadow-primary-orange/30
                    flex items-center justify-center gap-2"
                >
                  <MdCheck size={20} />
                  <span>Verify & Join Chat</span>
                </button>
              </>
            ) : (
              <>
                <div className="animate-spin w-12 h-12 border-4 border-[#333] border-t-primary-orange rounded-full mx-auto mb-4" />
                <p className="text-white font-medium">{connectionStatus}</p>
                <p className="text-gray-500 text-sm mt-2">This may take a moment...</p>
              </>
            )}
            <button
              onClick={resetConnection}
              className="mt-6 text-red-400 hover:text-red-300 text-sm transition-colors font-bold uppercase tracking-widest"
            >
              Cancel
            </button>
          </div>
        )}

        {/* ─── CHAT PHASE ─── */}
        {phase === "chat" && (
          <div className="bg-[#1a1a1a] rounded-2xl border border-[#333] shadow-2xl flex flex-col w-full overflow-hidden"
            style={{ height: "80vh" }}>
            
            {/* Chat Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#333] bg-[#1e1e1e]">
              <div className="flex items-center gap-3">
                <span className={`w-3 h-3 rounded-full ${isConnected ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
                <div>
                  <h2 className="text-white font-bold text-sm uppercase tracking-widest">Secure P2P Channel</h2>
                  <p className="text-gray-500 text-[10px] font-mono">
                    {peerNfd?.name || (peerAddress ? shortenAddr(peerAddress) : "Connecting...")}
                  </p>
                </div>
              </div>
              <button
                onClick={resetConnection}
                className="px-4 py-2 rounded-lg text-red-400 border border-red-400/30 hover:bg-red-400/10 transition-colors text-xs font-bold"
              >
                Terminate
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-6 bg-[#141414]">
              {messages.length === 0 && (
                <div className="text-center py-20">
                  <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4 border border-white/10">
                    <span className="text-2xl">🔒</span>
                  </div>
                  <p className="text-gray-400 text-sm font-medium">End-to-End Encrypted Session Active</p>
                  <p className="text-gray-600 text-xs mt-1">Messages are ephemeral and never stored.</p>
                </div>
              )}

              {messages.map((msg, i) => {
                const isMe = msg.sender === "me";
                const nfd = isMe ? myNfd : peerNfd;
                const addr = isMe ? activeAddress : peerAddress;
                
                return (
                  <div
                    key={i}
                    className={`flex w-full gap-3 ${isMe ? "flex-row-reverse" : "flex-row"}`}
                  >
                    {/* Avatar */}
                    <div 
                      onClick={() => addr && setShowIdentityCard({ address: addr, nfd })}
                      className="flex-shrink-0 w-9 h-9 rounded-full bg-[#222] border border-white/10 overflow-hidden cursor-pointer hover:border-primary-orange transition-all self-end mb-1 shadow-lg"
                    >
                      {nfd?.avatar ? (
                        <img src={nfd.avatar} alt="avatar" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-600">
                          <MdPerson size={20} />
                        </div>
                      )}
                    </div>

                    <div
                      className={`max-w-[85%] sm:max-w-[70%] px-4 py-3 rounded-2xl text-sm whitespace-pre-wrap break-words shadow-md ${
                        isMe
                          ? "bg-gradient-to-br from-primary-orange to-[#e06b10] text-white rounded-br-md"
                          : "bg-[#2a2a3a] text-gray-100 rounded-bl-md"
                      }`}
                    >
                      {/* Name tag for peer */}
                      {!isMe && nfd?.name && (
                        <div className="text-[10px] font-black text-primary-orange mb-1 uppercase tracking-tighter">
                          {nfd.name}
                        </div>
                      )}

                      {/* Media Preview Logic */}
                      {msg.type === "file-complete" && msg.fileUrl && (
                        <div className="mb-2 rounded-xl overflow-hidden border border-white/10 bg-black/40">
                          {msg.fileType?.startsWith("image/") ? (
                            <img src={msg.fileUrl} alt={msg.fileName} className="max-w-full h-auto block" />
                          ) : msg.fileType?.startsWith("video/") ? (
                            <video src={msg.fileUrl} controls className="max-w-full block" />
                          ) : (
                            <div className="p-6 text-center">
                              <span className="text-4xl block mb-3">📄</span>
                              <span className="text-xs opacity-70 block truncate font-mono">{msg.fileName}</span>
                            </div>
                          )}
                          <a
                            href={msg.fileUrl}
                            download={msg.fileName}
                            className="flex items-center justify-center gap-2 py-3 px-4 bg-white/5 hover:bg-white/20 transition-colors text-xs font-bold border-t border-white/5"
                          >
                            <MdImage size={14} /> Download
                          </a>
                        </div>
                      )}
                      
                      {/* Text Content with Linkify */}
                      <div className="leading-relaxed">
                        {msg.text.split(/(\s+)/).map((part, index) => {
                          if (/^(https?:\/\/[^\s]+)$/.test(part)) {
                            return (
                              <a 
                                key={index} 
                                href={part} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:underline break-all"
                              >
                                {part}
                              </a>
                            );
                          }
                          return part;
                        })}
                      </div>
                      
                      <div className={`text-[9px] mt-2 opacity-40 flex justify-between items-center font-mono ${isMe ? "text-white" : "text-gray-400"}`}>
                        <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-[#333] bg-[#1e1e1e]">
              <div className="flex items-end gap-2 bg-[#262626] rounded-2xl border border-[#3a3a3a] p-2 focus-within:border-primary-orange/50 transition-all">
                <button
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.onchange = (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (file) {
                        if (file.size > 50 * 1024 * 1024) {
                          toast.error("File too large. Max 50MB.");
                          return;
                        }
                        sendFile(file);
                      }
                    };
                    input.click();
                  }}
                  className="p-3 rounded-xl hover:bg-white/5 text-gray-500 hover:text-primary-orange transition-all"
                  title="Send file (max 50MB)"
                >
                  <MdImage size={22} />
                </button>

                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onPaste={handlePaste}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="Type a message or paste an image..."
                  className="flex-1 bg-transparent text-white py-3 px-2 outline-none text-sm min-h-[48px] max-h-[150px] resize-none"
                  rows={1}
                />

                <button
                  onClick={sendMessage}
                  disabled={!inputText.trim()}
                  className="p-3 bg-primary-orange hover:bg-primary-orange/80 disabled:opacity-20 disabled:grayscale rounded-xl text-black transition-all shadow-lg shadow-primary-orange/10"
                >
                  <MdCheck size={22} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Info & Use Cases Section */}
        {phase === "setup" && (
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Security Info */}
            <div className="p-6 rounded-2xl bg-[#1a1a1a] border border-[#333] shadow-xl">
              <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2 uppercase tracking-widest">
                <span className="text-primary-orange">🔒</span> Security Specs
              </h3>
              <ul className="space-y-3">
                <li className="flex gap-3 text-xs text-gray-400 leading-relaxed">
                  <span className="text-primary-orange font-bold">01.</span>
                  <span><strong>Wallet-Verified Handshake:</strong> Both peers must sign an off-chain transaction to prove ownership before the pipe opens.</span>
                </li>
                <li className="flex gap-3 text-xs text-gray-400 leading-relaxed">
                  <span className="text-primary-orange font-bold">02.</span>
                  <span><strong>Direct P2P:</strong> No servers, no logs, and no central databases. Your data exists only in your browser's RAM.</span>
                </li>
                <li className="flex gap-3 text-xs text-gray-400 leading-relaxed">
                  <span className="text-primary-orange font-bold">03.</span>
                  <span><strong>Encrypted Streams:</strong> Secure WebRTC data channels for all messages and file transfers.</span>
                </li>
              </ul>
            </div>

            {/* Use Cases */}
            <div className="p-6 rounded-2xl bg-[#1a1a1a] border border-[#333] shadow-xl">
              <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2 uppercase tracking-widest">
                <span className="text-primary-orange">🚀</span> Common Use Cases
              </h3>
              <ul className="space-y-3">
                <li className="flex gap-3 text-xs text-gray-400 leading-relaxed">
                  <span className="text-primary-orange font-bold">→</span>
                  <span><strong>Secure OTC Trading:</strong> Verify a wallet owner's identity via NFD before discussing high-value asset swaps.</span>
                </li>
                <li className="flex gap-3 text-xs text-gray-400 leading-relaxed">
                  <span className="text-primary-orange font-bold">→</span>
                  <span><strong>Confidential Networking:</strong> Connect with "Whales" or Developers directly without exposing your social handles.</span>
                </li>
                <li className="flex gap-3 text-xs text-gray-400 leading-relaxed">
                  <span className="text-primary-orange font-bold">→</span>
                  <span><strong>Private Support:</strong> Send screenshots or log files directly to a developer for debugging without hosting them on Discord/Telegram.</span>
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* Identity Card Modal */}
        {showIdentityCard && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
            <div className="bg-[#1a1a1a] border border-white/10 rounded-[2.5rem] w-full max-w-sm overflow-hidden shadow-2xl">
              <div className="relative p-8 text-center">
                <button 
                  onClick={() => setShowIdentityCard(null)}
                  className="absolute top-6 right-6 text-gray-500 hover:text-white transition-colors"
                >
                  <MdClose size={24} />
                </button>

                <div className="w-24 h-24 rounded-full bg-[#333] border-4 border-primary-orange mx-auto mb-6 overflow-hidden shadow-xl shadow-primary-orange/20">
                  {showIdentityCard.nfd?.avatar ? (
                    <img src={showIdentityCard.nfd.avatar} alt="avatar" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-500">
                      <MdPerson size={48} />
                    </div>
                  )}
                </div>

                <h3 className="text-2xl font-black text-white mb-1">
                  {showIdentityCard.nfd?.name || "Anonymous Peer"}
                </h3>
                <p className="text-primary-orange text-[10px] font-black uppercase tracking-widest mb-6 px-4 py-1 bg-primary-orange/10 rounded-full inline-block">
                  {showIdentityCard.nfd?.name ? "Verified NFD Identity" : "Unverified Wallet"}
                </p>

                <div className="bg-black/40 rounded-2xl p-4 border border-white/5 mb-6">
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Wallet Address</p>
                  <p className="text-gray-300 font-mono text-xs break-all leading-relaxed">
                    {showIdentityCard.address}
                  </p>
                </div>

                <button
                  onClick={() => {
                    navigator.clipboard.writeText(showIdentityCard.address);
                    setIsCopied(true);
                    setTimeout(() => setIsCopied(false), 2000);
                  }}
                  className="w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all duration-300 bg-white/5 hover:bg-white/10 text-white border border-white/10"
                >
                  {isCopied ? (
                    <>
                      <MdCheck className="text-green-400" />
                      <span className="text-green-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <MdContentCopy />
                      <span>Copy Address</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
