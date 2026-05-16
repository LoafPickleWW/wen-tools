import { useState, useRef, useCallback, useEffect } from "react";
import { useWallet } from "@txnlab/use-wallet-react";
import algosdk from "algosdk";
import { toast } from "react-toastify";
import nacl from "tweetnacl";
import { MdClose, MdAttachFile, MdInfo } from "react-icons/md";
import { pinJSONToCrust } from "../crust";
import {
  encryptDeadDrop,
  encryptBinaryDeadDrop,
  decryptDeadDrop,
  decryptBinaryDeadDrop,
  deriveKeyFromSignature,
  uint8ToBase64,
  base64ToUint8
} from "../utils/deadDropCrypto";
import { BEACON_PROTOCOL_ADDRESS, MAINNET_ALGONODE_INDEXER } from "../constants";
import { Meta } from "../components/Meta";

// The standard BEACON prefix used to filter transactions
const BEACON_PREFIX = "BEACON/1:";
const BEACON_PREFIX_B64 = btoa(BEACON_PREFIX);

export function BeaconDropTool() {
  const { activeAddress, algodClient, signTransactions } = useWallet();

  // Session caching for deterministic keypair
  const beaconKeypairRef = useRef<nacl.BoxKeyPair | null>(null);

  // Dead Drop States
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [uninitializedRecipient, setUninitializedRecipient] = useState<string>("");
  const [showUninitializedModal, setShowUninitializedModal] = useState(false);
  const [ddRecipient, setDdRecipient] = useState("");
  const [ddMessage, setDdMessage] = useState("");
  const [ddFile, setDdFile] = useState<File | null>(null);
  const [ddLoading, setDdLoading] = useState(false);
  const [retrievedDrops, setRetrievedDrops] = useState<any[]>([]);

  // Check if active address has initialized their inbox
  useEffect(() => {
    if (!activeAddress) {
      setIsInitialized(false);
      return;
    }
    const checkInit = async () => {
      try {
        const indexerUrl = `${MAINNET_ALGONODE_INDEXER}/v2/accounts/${activeAddress}/transactions?note-prefix=${BEACON_PREFIX_B64}&limit=100`;
        const res = await fetch(indexerUrl);
        const data = await res.json();
        let found = false;
        for (const tx of data.transactions || []) {
          if (!tx.note || tx["payment-transaction"]?.receiver !== BEACON_PROTOCOL_ADDRESS) continue;
          try {
            const noteStr = new TextDecoder().decode(base64ToUint8(tx.note));
            if (!noteStr.startsWith(BEACON_PREFIX)) continue;
            
            const payload = JSON.parse(atob(noteStr.slice(BEACON_PREFIX.length)));
            if (payload.type === "announce") {
              found = true;
              break;
            }
          } catch {
            // ignore parsing error
          }
        }
        setIsInitialized(found);
      } catch {
        setIsInitialized(false);
      }
    };
    checkInit();
  }, [activeAddress]);

  const getBeaconKeypair = useCallback(async () => {
    if (beaconKeypairRef.current) return beaconKeypairRef.current;
    if (!activeAddress || !signTransactions) throw new Error("Wallet not connected");

    // Deterministic transaction for signature (never broadcast)
    const domainTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: activeAddress,
      to: activeAddress,
      amount: 0,
      note: new TextEncoder().encode("BEACON/1:derive-encryption-key"),
      suggestedParams: {
        genesisHash: "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=", // mainnet
        genesisID: "mainnet-v1.0",
        firstRound: 10,
        lastRound: 20,
        fee: 0,
        flatFee: true,
      } as any
    });

    const encodedDomainTxn = algosdk.encodeUnsignedTransaction(domainTxn);
    const signed = await signTransactions([encodedDomainTxn]);
    if (!signed || !signed[0]) throw new Error("Cancelled auth signature");

    const sigBytes = algosdk.decodeSignedTransaction(signed[0]).sig;
    if (!sigBytes) throw new Error("No signature found");

    beaconKeypairRef.current = deriveKeyFromSignature(sigBytes);
    return beaconKeypairRef.current;
  }, [activeAddress, signTransactions]);

  const handleAnnounce = async () => {
    if (!activeAddress || !signTransactions || !algodClient) {
      toast.error("Please connect your wallet");
      return;
    }
    setDdLoading(true);
    try {
      const keypair = await getBeaconKeypair();
      const wpk = uint8ToBase64(keypair.publicKey);
      
      const payload = { proto: "BEACON/1", type: "announce", wpk, ts: Date.now() };
      const payloadString = JSON.stringify(payload);
      const noteBytes = new TextEncoder().encode(`${BEACON_PREFIX}${btoa(payloadString)}`);

      const suggestedParams = await algodClient.getTransactionParams().do();
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: activeAddress,
        to: BEACON_PROTOCOL_ADDRESS,
        amount: 0,
        note: noteBytes,
        suggestedParams: { ...suggestedParams, fee: 1000, flatFee: true },
      });

      const signedTxn = await signTransactions([algosdk.encodeUnsignedTransaction(txn)]);
      if (!signedTxn || !signedTxn[0]) throw new Error("Transaction cancelled.");

      const { txId } = await algodClient.sendRawTransaction(signedTxn[0]).do();
      toast.success(`Inbox Initialized! TxID: ${txId.slice(0, 8)}...`);
      setIsInitialized(true);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to announce key");
    } finally {
      setDdLoading(false);
    }
  };

  const handleDeployDrop = async () => {
    if (!activeAddress || !signTransactions || !algodClient) {
      toast.error("Please connect your wallet");
      return;
    }
    setDdLoading(true);
    setUninitializedRecipient("");
    setShowUninitializedModal(false);
    try {
      let targetAddr = ddRecipient.trim();

      // Resolve NFD if needed
      if (targetAddr.toLowerCase().endsWith(".algo")) {
        const nfdData = await fetch(`https://api.nf.domains/nfd/${targetAddr.toLowerCase()}?view=tiny`).then(r => r.json());
        if (nfdData.depositAccount) {
          targetAddr = nfdData.depositAccount;
        } else {
          throw new Error("Could not resolve NFD");
        }
      }

      // Query Indexer for recipient's announce message to get their wpk
      const indexerUrl = `${MAINNET_ALGONODE_INDEXER}/v2/accounts/${targetAddr}/transactions?note-prefix=${BEACON_PREFIX_B64}&limit=100`;
      
      let res;
      try {
        res = await fetch(indexerUrl);
        if (!res.ok) throw new Error("Invalid address");
      } catch {
        throw new Error(`Failed to query network for ${targetAddr}. Ensure the address is correct.`);
      }
      
      const data = await res.json();
      const txns = data.transactions || [];
      
      let recipientPubKey = "";
      for (const tx of txns) {
        if (!tx.note || tx["payment-transaction"]?.receiver !== BEACON_PROTOCOL_ADDRESS) continue;
        try {
          const noteStr = new TextDecoder().decode(base64ToUint8(tx.note));
          if (!noteStr.startsWith(BEACON_PREFIX)) continue;
          
          const payload = JSON.parse(atob(noteStr.slice(BEACON_PREFIX.length)));
          if (payload.type === "announce" && payload.wpk) {
             recipientPubKey = payload.wpk;
             break; // Use the most recent announce
          }
        } catch {
          // ignore parsing error
        }
      }

      if (!recipientPubKey) {
        setUninitializedRecipient(ddRecipient.trim());
        setShowUninitializedModal(true);
        throw new Error("Recipient has not initialized their BEACON inbox yet!");
      }

      let payloadData: any;

      if (ddFile) {
        const reader = new FileReader();
        const fileData = await new Promise<Uint8Array>((resolve) => {
          reader.onload = (e) => resolve(new Uint8Array(e.target?.result as ArrayBuffer));
          reader.readAsArrayBuffer(ddFile);
        });

        const encryptedFile = await encryptBinaryDeadDrop(fileData, targetAddr, recipientPubKey);
        
        const authBasic = localStorage.getItem("authBasic");
        const cid = await pinJSONToCrust(authBasic, JSON.stringify(encryptedFile));
        
        payloadData = {
          type: "file",
          cid,
          fileName: ddFile.name,
          fileSize: ddFile.size,
          fileType: ddFile.type,
          recipient: targetAddr
        };
      } else {
        const encrypted = await encryptDeadDrop(ddMessage, targetAddr, recipientPubKey);
        payloadData = { ...encrypted, type: "text", recipient: targetAddr };
      }

      // Convert payload into BEACON format Note string
      const payloadString = JSON.stringify(payloadData);
      const payloadNoteStr = `${BEACON_PREFIX}${btoa(payloadString)}`;
      const noteBytes = new TextEncoder().encode(payloadNoteStr);

      if (noteBytes.length > 1024) {
        throw new Error("Payload too large for Algorand Note field! (Max 1KB)");
      }

      // Construct a 0 ALGO transaction to the Shared Protocol Address (BEACON_PROTOCOL_ADDRESS)
      const suggestedParams = await algodClient.getTransactionParams().do();
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: activeAddress,
        to: BEACON_PROTOCOL_ADDRESS,
        amount: 0,
        note: noteBytes,
        suggestedParams: { ...suggestedParams, fee: 1000, flatFee: true },
      });

      const encodedTxn = algosdk.encodeUnsignedTransaction(txn);
      const signedTxn = await signTransactions([encodedTxn]);

      if (!signedTxn || !signedTxn[0]) {
        throw new Error("Transaction cancelled.");
      }

      const { txId } = await algodClient.sendRawTransaction(signedTxn[0]).do();
      
      toast.success(`BEACON Drop deployed! TxID: ${txId.slice(0, 8)}...`);
      setDdMessage("");
      setDdFile(null);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to create BEACON drop");
    } finally {
      setDdLoading(false);
    }
  };

  const handleScanDrops = async () => {
    if (!activeAddress || !signTransactions || !algodClient) {
      toast.error("Please connect your wallet");
      return;
    }
    
    setDdLoading(true);
    try {
      // Prompt user for signature to derive Web Key deterministically
      const keypair = await getBeaconKeypair();
      const secretKey = keypair.secretKey;

      toast.info(`Scanning BEACON Protocol Address for drops...`);

      // Query Indexer for all transactions to BEACON_PROTOCOL_ADDRESS with the BEACON prefix
      // In production you might paginate this and keep a last-round tracker.
      const indexerUrl = `${MAINNET_ALGONODE_INDEXER}/v2/accounts/${BEACON_PROTOCOL_ADDRESS}/transactions?note-prefix=${BEACON_PREFIX_B64}&limit=100`;
      const res = await fetch(indexerUrl);
      const data = await res.json();

      const txns = data.transactions || [];
      const allDrops: any[] = [];

      for (const tx of txns) {
        try {
          if (!tx.note) continue;
          const noteBytes = base64ToUint8(tx.note);
          const noteStr = new TextDecoder().decode(noteBytes);

          if (!noteStr.startsWith(BEACON_PREFIX)) continue;
          
          const payloadB64 = noteStr.slice(BEACON_PREFIX.length);
          const payloadStr = atob(payloadB64);
          const drop = JSON.parse(payloadStr);

          // If the drop specifies a recipient and it's not us, skip.
          if (drop.recipient && drop.recipient !== activeAddress) continue;

          allDrops.push(drop);
        } catch {
          // ignore parsing errors for individual notes
        }
      }

      if (allDrops.length > 0) {
        // Attempt decryption
        const processed = await Promise.all(allDrops.map(async (drop: any) => {
          try {
            if (drop.type === "file") {
              // Fetch from Crust
              const fileRes = await fetch(`https://crustipfs.mobi/ipfs/${drop.cid}`);
              const encryptedFileJson = await fileRes.json();
              
              const decryptedBytes = decryptBinaryDeadDrop(encryptedFileJson.ciphertext, encryptedFileJson.nonce, encryptedFileJson.ephemeralPk, secretKey);
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

          } catch { 
            return { ...drop, decrypted: "Decryption failed. (Encrypted for a different key or native address key)." }; 
          }
        }));

        // Filter out drops that failed to decrypt entirely
        const successfulDrops = processed.filter(d => !d.decrypted.includes("Decryption failed"));

        setRetrievedDrops(successfulDrops);
        if (successfulDrops.length > 0) {
            toast.success(`Found and decrypted ${successfulDrops.length} drop(s)!`);
        } else {
            toast.info(`Found ${allDrops.length} drops, but none were decryptable by your key.`);
        }
        
      } else {
        toast.info("No BEACON drops found.");
      }

    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to scan drops");
    } finally {
      setDdLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center w-full px-4 py-8 min-h-[80vh]">
      <Meta 
        title="BEACON Drop Tool" 
        description="Securely send and receive encrypted messages and files on-chain using the BEACON protocol. Fully decentralized, serverless peer-to-peer communication on Algorand."
      />
      <div className="w-full max-w-2xl bg-[#1a1a1a] rounded-2xl p-8 border border-[#333] shadow-2xl">
        <div className="flex flex-col items-center justify-center mb-8">
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <span className="text-primary-orange">📡</span> BEACON Drop
          </h1>
          <p className="text-primary-orange/80 mt-2 text-sm uppercase tracking-widest font-bold">
            Serverless • On-Chain • Peer-to-Peer
          </p>
          <div className="mt-4 px-4 py-2 bg-primary-orange/10 border border-primary-orange/30 rounded-lg flex items-center gap-2 text-xs text-primary-orange max-w-md text-center leading-relaxed">
            <MdInfo size={24} className="shrink-0" />
            <span>
              Powered by the open <a href="https://github.com/LoafPickleWW/BEACON-Protocol" target="_blank" rel="noopener noreferrer" className="underline hover:text-white transition-colors"><strong>BEACON Protocol</strong></a>. Your drops are sent as 0 ALGO transactions 
              to a shared on-chain noticeboard. No central servers or relays are used.
            </span>
          </div>
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
                onClick={(e) => {
                  e.preventDefault();
                  handleDeployDrop();
                }}
                className="w-full py-4 bg-primary-orange text-white rounded-xl font-bold disabled:opacity-30"
              >
                {ddLoading ? "Encrypting & Broadcasting..." : "Broadcast BEACON Drop"}
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
                  </div>
                ))}
                <button onClick={() => setRetrievedDrops([])} className="w-full py-2 text-[10px] text-gray-500 uppercase font-black hover:text-white transition-colors">Clear Retrieved Drops</button>
              </div>
            ) : (
              <p className="text-xs text-gray-400 mb-6 leading-relaxed">
                Scan the global BEACON smart address on the Algorand blockchain. Any messages encrypted with your public key will be automatically decrypted here.
              </p>
            )}

            {isInitialized === false ? (
              <button 
                disabled={ddLoading}
                onClick={handleAnnounce}
                className="w-full py-4 rounded-xl border-2 border-primary-orange bg-primary-orange text-black font-bold hover:bg-white hover:border-white transition-all disabled:opacity-30"
              >
                {ddLoading ? "Initializing..." : "Initialize BEACON Inbox"}
              </button>
            ) : (
              <button 
                disabled={ddLoading}
                onClick={handleScanDrops}
                className="w-full py-4 rounded-xl border-2 border-primary-orange text-primary-orange font-bold hover:bg-primary-orange/10 transition-all disabled:opacity-30"
              >
                {ddLoading ? "Scanning Network..." : "Scan BEACON Protocol Address"}
              </button>
            )}
          </div>
        </div>
      </div>

      {showUninitializedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#1a1a1a] border border-[#333] rounded-2xl p-8 max-w-md w-full shadow-2xl relative">
            <button onClick={() => setShowUninitializedModal(false)} className="absolute top-4 right-4 text-gray-500 hover:text-white">
              <MdClose size={24} />
            </button>
            <h2 className="text-2xl font-bold text-white mb-4">Inbox Not Found</h2>
            <p className="text-gray-400 mb-6 text-sm leading-relaxed">
              The recipient wallet <strong className="text-white break-all">{uninitializedRecipient}</strong> has not initialized their BEACON inbox yet. 
              Because BEACON is fully decentralized, they must opt-in before you can securely send them an encrypted drop.
            </p>
            <div className="p-4 bg-black rounded-xl border border-[#333] mb-6 font-mono text-xs text-primary-orange break-all text-center">
              https://tools.wen.so/beacon-drop
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`Hey! Initialize your BEACON inbox on Wen Tools so I can send you a secure drop: https://tools.wen.so/beacon-drop`);
                toast.success("Copied share message to clipboard!");
              }}
              className="w-full py-3 bg-primary-orange text-black font-bold uppercase tracking-widest rounded-xl hover:bg-white transition-all shadow-[0_0_20px_rgba(255,165,0,0.3)] hover:shadow-[0_0_30px_rgba(255,165,0,0.6)]"
            >
              Copy Share Link
            </button>
          </div>
        </div>
      )}
      {/* Practitioner Section: Serverless Peer-to-Peer Signaling */}
      <section className="mt-20 pt-12 border-t border-slate-800 w-full max-w-4xl text-left px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white tracking-tight italic">Serverless Peer-to-Peer Signaling</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              The BEACON protocol eliminates the need for centralized signaling servers by utilizing the Algorand ledger as a global, tamper-proof message board. By broadcasting encrypted payloads to a shared protocol address, users can coordinate handshakes and share data directly, ensuring that the communication channel remains as resilient and decentralized as the underlying blockchain.
            </p>
          </div>
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white tracking-tight italic">On-Chain Confidentiality</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Confidentiality in a public ledger is achieved through robust asymmetric encryption. Every BEACON drop is encrypted with the recipient's public key, ensuring that only the intended party can decrypt and view the contents. This architecture provides a professional-grade solution for sharing sensitive metadata, project credentials, or private communication without compromising on-chain transparency.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
