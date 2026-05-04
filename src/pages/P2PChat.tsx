import { useState, useEffect, useRef, useCallback } from "react";
import { useWallet } from "@txnlab/use-wallet-react";
import algosdk from "algosdk";
import { Peer, type DataConnection } from "peerjs";
import nacl from "tweetnacl";
import { toast } from "react-toastify";
import QRCode from "qrcode";

// ── Browser-safe base64 helpers (no Buffer dependency) ──
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/* 
  LEGACY LIQUIDAUTH IMPORTS (Preserved for reference)
  import { SignalClient } from "@algorandfoundation/liquid-client";
  import { toBase64URL } from "@algorandfoundation/liquid-client/encoding";
  import nacl from "tweetnacl";
  const LIQUID_SERVER = "https://wen-liquid-auth.onrender.com";
*/

interface ChatMessage {
  text: string;
  sender: "me" | "peer";
  timestamp: number;
  type: "text" | "file-meta" | "file-chunk" | "file-complete";
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  fileId?: string;
}

type Phase = "setup" | "waiting" | "connecting" | "chat";

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

  // Cleanup on unmount
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
        nonce
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
        // Offerer sends the challenge nonce
        const nonce = (conn as any)._challengeNonce as string;
        conn.send({ type: "challenge", nonce });
        setConnectionStatus("Challenge sent. Waiting for handshake...");
      } else {
        setConnectionStatus("Connected. Waiting for challenge...");
      }
    });

    conn.on("data", (data: any) => {
      if (!data) return;

      // ── Joiner receives challenge and sends handshake ──
      if (data.type === "challenge" && role === "joiner") {
        sendHandshake(conn, data.nonce);
        return;
      }
      
      // ── Offerer receives and verifies handshake ──
      if (data.type === "handshake") {
        try {
          const { txnB64, sigB64, nonce } = data;
          const unsignedBytes = base64ToUint8(txnB64);
          const signedBytes = base64ToUint8(sigB64);

          // Decode the signed transaction properly
          const signedTxn = algosdk.decodeSignedTransaction(signedBytes);
          const txn = signedTxn.txn;

          console.log("[P2P Debug] signedTxn keys:", Object.keys(signedTxn));
          console.log("[P2P Debug] has sig:", !!signedTxn.sig);
          console.log("[P2P Debug] sig length:", signedTxn.sig?.length);
          
          if (!signedTxn.sig) throw new Error("No signature found");

          // Verify note contains our nonce
          const noteBytes = txn.note;
          const noteStr = noteBytes ? new TextDecoder().decode(noteBytes) : "";
          console.log("[P2P Debug] note:", noteStr);
          console.log("[P2P Debug] nonce:", nonce);
          if (!noteStr.includes(nonce)) {
            throw new Error("Invalid nonce in handshake");
          }

          // Get the sender's address
          const senderAddr = algosdk.encodeAddress(txn.from.publicKey);

          // Get the authorized signer's public key.
          // If the account is rekeyed, the signature is valid for the 'sgnr' address.
          const signerKey = signedTxn.sgnr ? signedTxn.sgnr : txn.from.publicKey;
          const verifiedAddr = algosdk.encodeAddress(signerKey);
          
          console.log("[P2P Debug] sender address (from):", senderAddr);
          console.log("[P2P Debug] signer address (sgnr):", verifiedAddr);

          // The wallet signs over "TX" + msgpack(txn dictionary)
          const rawTxn = algosdk.decodeUnsignedTransaction(unsignedBytes);
          const bytesToVerify = rawTxn.bytesToSign();

          const isValid = nacl.sign.detached.verify(
            bytesToVerify,
            signedTxn.sig,
            signerKey
          );
          
          console.log("[P2P Debug] isValid:", isValid);

          if (isValid) {
            setPeerAddress(verifiedAddr);
            setPhase("chat");
            setIsConnected(true);
            setConnectionStatus("Connected");
            conn.send({ type: "handshake-success" });
            toast.success("Identity verified! Connection established.");
            startHeartbeat();
          } else {
            throw new Error("Invalid signature");
          }
        } catch (err: any) {
          console.error("Handshake failed:", err);
          toast.error("Handshake failed: " + err.message);
          conn.close();
        }
        return;
      }

      if (data.type === "handshake-success") {
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
        setMessages((prev) => [
          ...prev,
          {
            text: `📎 Receiving file: ${data.fileName} (${formatFileSize(data.fileSize)})`,
            sender: "peer",
            timestamp: Date.now(),
            type: "file-meta",
            fileName: data.fileName,
            fileSize: data.fileSize,
            fileType: data.fileType,
            fileId: data.fileId,
          },
        ]);
        return;
      }

      if (data.type === "file-chunk") {
        const chunks = fileChunksRef.current.get(data.fileId);
        if (chunks) {
          chunks.push(new Uint8Array(data.data));
        }
        return;
      }

      if (data.type === "file-complete") {
        const chunks = fileChunksRef.current.get(data.fileId);
        if (chunks) {
          const blob = new Blob(chunks.map(c => new Uint8Array(c)) as BlobPart[], { type: data.fileType });
          const url = URL.createObjectURL(blob);
          setMessages((prev) => [
            ...prev,
            {
              text: `📥 File ready: ${data.fileName}`,
              sender: "peer",
              timestamp: Date.now(),
              type: "file-complete",
              fileName: data.fileName,
              fileId: data.fileId,
            },
          ]);
          const a = document.createElement("a");
          a.href = url;
          a.download = data.fileName;
          a.click();
          fileChunksRef.current.delete(data.fileId);
        }
        return;
      }

      setMessages((prev) => [
        ...prev,
        { text: data.text || "Message received", sender: "peer", timestamp: Date.now(), type: "text" },
      ]);
    });

    conn.on("close", () => {
      setIsConnected(false);
      setConnectionStatus("Disconnected");
      toast.info("Peer disconnected");
      resetConnection();
    });

    conn.on("error", (err) => {
      console.error("Connection error:", err);
      toast.error("Connection error");
      resetConnection();
    });
  }, [resetConnection, sendHandshake, startHeartbeat]);


  const startOfferSession = useCallback(async () => {
    if (!activeAddress) {
      toast.error("Please connect your wallet first.");
      return;
    }
    try {
      setPhase("waiting");
      setConnectionStatus("Initializing PeerJS...");
      
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
        
        // Use the current URL minus existing query params to ensure the path is correct
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
      });

      peer.on("connection", (conn) => {
        // Store the nonce on the connection so handleConnection can use it
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
  }, [handleConnection, resetConnection, activeAddress]);

  const joinSession = useCallback(async (overrideSessionId?: any) => {
    const targetSessionId = typeof overrideSessionId === "string" ? overrideSessionId : remoteRequestId;

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
    if (session && !remoteRequestId) {
      setRemoteRequestId(session);
      // If already connected, trigger join immediately
      if (activeAddress && !hasAutoJoined.current && phase === "setup") {
        hasAutoJoined.current = true;
        joinSession(session);
      }
    }
  }, [joinSession, activeAddress, remoteRequestId, phase]);

  const sendMessage = useCallback(() => {
    if (!inputText.trim() || !connRef.current || !connRef.current.open) return;
    connRef.current.send({ type: "text", text: inputText.trim() });
    setMessages((prev) => [
      ...prev,
      { text: inputText.trim(), sender: "me", timestamp: Date.now(), type: "text" },
    ]);
    setInputText("");
  }, [inputText]);

  const sendFile = useCallback(async (file: File) => {
    if (!connRef.current || !connRef.current.open) return;
    const fileId = crypto.randomUUID();
    const CHUNK_SIZE = 16384; 

    connRef.current.send({
        type: "file-meta",
        fileId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
    });

    setMessages((prev) => [
      ...prev,
      {
        text: `📎 Sending file: ${file.name} (${formatFileSize(file.size)})`,
        sender: "me",
        timestamp: Date.now(),
        type: "file-meta",
        fileName: file.name,
        fileSize: file.size,
        fileId,
      },
    ]);

    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
      const chunk = data.slice(offset, offset + CHUNK_SIZE);
      connRef.current.send({
          type: "file-chunk",
          fileId,
          data: chunk, // Send raw Uint8Array for performance
      });
      await new Promise((r) => setTimeout(r, 10));
    }

    connRef.current.send({
        type: "file-complete",
        fileId,
        fileName: file.name,
        fileType: file.type,
    });

    toast.success(`File sent: ${file.name}`);
  }, []);

  const handleFileSelect = useCallback(() => {
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
  }, [sendFile]);

  const copyShareLink = useCallback(() => {
    navigator.clipboard.writeText(deepLinkUrl);
    toast.success("Link copied!");
  }, [deepLinkUrl]);

  const shortenAddr = (addr: string) =>
    addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";

  // ─── RENDER ───
  return (
    <div className="flex flex-col items-center justify-center w-full px-4 py-8 min-h-[80vh]">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
            🔐 P2P Encrypted Chat
          </h1>
          <p className="text-gray-400 text-sm">
            End-to-end encrypted via Off-Chain Handshake + PeerJS • No Fees
          </p>
        </div>

        {/* ─── SETUP PHASE ─── */}
        {phase === "setup" && (
          <div className="bg-[#1a1a1a] rounded-2xl p-8 border border-[#333] shadow-2xl">
            <div className="flex flex-col gap-6">
              {/* Create Session */}
              <div className="p-6 rounded-xl bg-gradient-to-br from-[#1e1e2e] to-[#12121a] border border-[#2a2a3a]">
                <h2 className="text-xl font-semibold text-white mb-2">Start a Session</h2>
                <p className="text-gray-400 text-sm mb-4">
                  Generate a QR code & link to share with someone
                </p>
                <button
                  onClick={startOfferSession}
                  className="w-full py-3 px-6 rounded-xl font-semibold text-white
                    bg-gradient-to-r from-primary-orange to-[#e06b10]
                    hover:from-[#e06b10] hover:to-primary-orange
                    transition-all duration-300 shadow-lg hover:shadow-primary-orange/30"
                >
                  Create Session
                </button>
              </div>

              <div className="flex items-center gap-4">
                <div className="flex-1 h-px bg-[#333]" />
                <span className="text-gray-500 text-sm">OR</span>
                <div className="flex-1 h-px bg-[#333]" />
              </div>

              {/* Join Session */}
              <div className="p-6 rounded-xl bg-gradient-to-br from-[#1e1e2e] to-[#12121a] border border-[#2a2a3a]">
                <h2 className="text-xl font-semibold text-white mb-2">Join a Session</h2>
                {remoteRequestId && !activeAddress ? (
                  <div className="p-4 rounded-lg bg-primary-orange/10 border border-primary-orange/30 text-center">
                    <p className="text-primary-orange text-sm font-medium mb-1">Session ID Captured!</p>
                    <p className="text-gray-400 text-xs">Please connect your wallet above to join the chat.</p>
                  </div>
                ) : (
                  <>
                    <p className="text-gray-400 text-sm mb-4">
                      Enter the session ID or paste the shared link
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <input
                        type="text"
                        value={remoteRequestId}
                        onChange={(e) => setRemoteRequestId(e.target.value)}
                        placeholder="Session ID..."
                        className="flex-1 py-3 px-4 rounded-xl bg-[#242424] border border-[#333]
                          text-white placeholder-gray-500 outline-none focus:border-primary-orange
                          transition-colors"
                      />
                      <button
                        onClick={() => joinSession()}
                        className="py-3 px-6 rounded-xl font-semibold text-white
                          bg-gradient-to-r from-[#646cff] to-[#535bf2]
                          hover:from-[#535bf2] hover:to-[#646cff]
                          transition-all duration-300 shadow-lg hover:shadow-[#646cff]/30"
                      >
                        Join
                      </button>
                    </div>
                  </>
                )}
                <div className="mt-3">
                  <p className="text-gray-500 text-xs">
                    🔑 Authenticates via Off-Chain Wallet Signature
                  </p>
                </div>
              </div>

              {/* About Section */}
              <div className="p-6 rounded-xl bg-[#111] border border-[#222]">
                <h3 className="text-sm font-semibold text-gray-300 mb-2 flex items-center gap-2">
                  <span>ℹ️</span> About this feature
                </h3>
                <p className="text-gray-500 text-xs leading-relaxed mb-2">
                  This chat uses <strong>Direct Peer-to-Peer (WebRTC)</strong> technology. Unlike traditional apps, your messages never touch a central server.
                </p>
                <ul className="text-gray-500 text-xs list-disc list-inside space-y-1">
                  <li><strong>Verified Identity:</strong> Both peers must sign an off-chain transaction to prove they own their Algorand wallet address before the chat starts.</li>
                  <li><strong>E2E Encrypted:</strong> Communication is secured via a reliable WebRTC data channel.</li>
                  <li><strong>Zero Cost:</strong> No server infrastructure means this tool is (and always will be) free to use.</li>
                </ul>
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
                <code className="flex-1 text-primary-orange text-xs break-all text-left">
                  {deepLinkUrl}
                </code>
                <button
                  onClick={copyShareLink}
                  className="px-4 py-2 rounded-lg bg-primary-orange/20 text-primary-orange
                    hover:bg-primary-orange/30 transition-colors text-sm font-medium shrink-0"
                >
                  Copy
                </button>
              </div>
            </div>

            <p className="text-gray-500 text-xs mb-4">
              Session ID: <code className="text-gray-400">{requestId}</code>
            </p>

            <button
              onClick={resetConnection}
              className="text-red-400 hover:text-red-300 text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {/* ─── CONNECTING PHASE ─── */}
        {phase === "connecting" && (
          <div className="bg-[#1a1a1a] rounded-2xl p-8 border border-[#333] shadow-2xl text-center">
            <div className="animate-spin w-12 h-12 border-4 border-[#333] border-t-primary-orange rounded-full mx-auto mb-4" />
            <p className="text-white font-medium">{connectionStatus}</p>
            <p className="text-gray-500 text-sm mt-2">This may take a moment...</p>
            <button
              onClick={resetConnection}
              className="mt-4 text-red-400 hover:text-red-300 text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {/* ─── CHAT PHASE ─── */}
        {phase === "chat" && (
          <div className="bg-[#1a1a1a] rounded-2xl border border-[#333] shadow-2xl flex flex-col"
            style={{ height: "75vh" }}>
            {/* Chat Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#333]">
              <div className="flex items-center gap-3">
                <span className={`w-3 h-3 rounded-full ${isConnected ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
                <div>
                  <h2 className="text-white font-semibold text-lg">Encrypted Chat</h2>
                  {peerAddress && (
                    <p className="text-gray-400 text-xs">{shortenAddr(peerAddress)}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 px-3 py-1 rounded-full bg-[#0a0a0a] border border-[#222]">
                  🔒 E2E Encrypted
                </span>
                <button
                  onClick={resetConnection}
                  className="px-4 py-2 rounded-lg text-red-400 border border-red-400/30
                    hover:bg-red-400/10 transition-colors text-sm"
                >
                  Disconnect
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {messages.length === 0 && (
                <div className="text-center text-gray-500 text-sm mt-8">
                  <p>🔐 Connection established!</p>
                  <p className="mt-1">Messages are end-to-end encrypted and ephemeral.</p>
                </div>
              )}
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.sender === "me" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm break-words ${
                      msg.sender === "me"
                        ? "bg-gradient-to-r from-primary-orange to-[#e06b10] text-white rounded-br-md"
                        : "bg-[#2a2a3a] text-gray-100 rounded-bl-md"
                    } ${msg.type !== "text" ? "italic opacity-80" : ""}`}
                  >
                    {msg.text}
                    <div className={`text-[10px] mt-1 ${msg.sender === "me" ? "text-white/50" : "text-gray-500"}`}>
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="px-6 py-4 border-t border-[#333]">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleFileSelect}
                  className="p-3 rounded-xl bg-[#2a2a3a] text-gray-400 hover:text-white
                    hover:bg-[#3a3a4a] transition-colors"
                  title="Send file (max 50MB)"
                >
                  📎
                </button>
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                  placeholder="Type a message..."
                  className="flex-1 py-3 px-5 rounded-2xl bg-[#242424] border border-[#333]
                    text-white placeholder-gray-500 outline-none focus:border-primary-orange
                    transition-colors"
                />
                <button
                  onClick={sendMessage}
                  disabled={!inputText.trim()}
                  className="p-3 px-5 rounded-xl font-semibold text-white
                    bg-gradient-to-r from-primary-orange to-[#e06b10]
                    hover:from-[#e06b10] hover:to-primary-orange
                    disabled:opacity-30 disabled:cursor-not-allowed
                    transition-all duration-300"
                >
                  Send
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
