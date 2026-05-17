import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useWallet } from "@txnlab/use-wallet-react";
import { toast } from "react-toastify";
import { Meta } from "../components/Meta";
import ConnectButton from "../components/ConnectButton";
import {
  SwapItem, DecodedSwapTx, MAX_SWAP_TXS, WalletAsset,
  buildSwapGroup, createShareTx, fetchSwapFromTxIds, claimSwap,
  getAssetInfo, getAccountAssets, getAccountAssetsWithInfo,
} from "../utils/swap";
import { getNFTImageUrl } from "../utils";

// ── Recent Contacts (localStorage) ───────────────────────────────────────
const CONTACTS_KEY = "wenswap_recent_contacts";
const MAX_CONTACTS = 10;

function getRecentContacts(): string[] {
  try { return JSON.parse(localStorage.getItem(CONTACTS_KEY) || "[]"); } catch { return []; }
}

function saveContact(addr: string) {
  if (!addr || addr.length < 10) return;
  const existing = getRecentContacts().filter(a => a !== addr);
  existing.unshift(addr);
  localStorage.setItem(CONTACTS_KEY, JSON.stringify(existing.slice(0, MAX_CONTACTS)));
}

// ── Helpers ──────────────────────────────────────────────────────────────
const shorten = (a: string) => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";

const TX_TYPES = [
  { value: "", label: "Select Type" },
  { value: "pay", label: "ALGO Payment" },
  { value: "axfer", label: "ASA Transfer" },
  { value: "optin", label: "Opt-In" },
];

// ── Sub-component: single transaction row ────────────────────────────────
function TxRow({ item, index, total, update, remove, disabled }: {
  item: SwapItem; index: number; total: number;
  update: (id: number, field: keyof SwapItem, val: any) => void;
  remove: (id: number) => void; disabled: boolean;
}) {
  const [assetName, setAssetName] = useState("");
  const [walletAssets, setWalletAssets] = useState<WalletAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetSearch, setAssetSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch display name for the selected asset
  useEffect(() => {
    if (item.assetId && item.assetId > 1 && item.txType !== "pay") {
      const cached = walletAssets.find(a => a.id === item.assetId);
      if (cached) { setAssetName(`${cached.name} (${cached.unitName})`); return; }
      getAssetInfo(item.assetId).then(a => setAssetName(`${a.params.name} (${a.params["unit-name"]})`)).catch(() => setAssetName("Unknown"));
    } else { setAssetName(item.txType === "pay" ? "ALGO" : ""); }
  }, [item.assetId, item.txType, walletAssets]);

  // Load sender's assets when sender changes (streamed in batches)
  useEffect(() => {
    const sender = item.sender;
    if (!sender || (sender.length < 10 && !sender.endsWith(".algo"))) { setWalletAssets([]); return; }
    let cancelled = false;
    setAssetsLoading(true);
    getAccountAssetsWithInfo(sender, (batch) => {
      if (!cancelled) setWalletAssets(batch);
    })
      .catch(() => {})
      .finally(() => { if (!cancelled) setAssetsLoading(false); });
    return () => { cancelled = true; };
  }, [item.sender]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowDropdown(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filteredAssets = walletAssets.filter(a => {
    if (!assetSearch) return true;
    const q = assetSearch.toLowerCase();
    return a.name.toLowerCase().includes(q) || a.unitName.toLowerCase().includes(q) || String(a.id).includes(q);
  });

  const inputCls = "w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 outline-none transition-colors";

  return (
    <div className="relative bg-neutral-900/50 border border-neutral-800 rounded-xl p-4 space-y-3 animate-fade-in" style={{ overflow: "visible", zIndex: total - index }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Transaction {index + 1}</span>
        {!disabled && (
          <button onClick={() => remove(item.id)} className="text-neutral-600 hover:text-red-400 text-xs transition-colors">✕ Remove</button>
        )}
      </div>
      <select value={item.txType} disabled={disabled} onChange={e => update(item.id, "txType", e.target.value)}
        className={`${inputCls} ${!item.txType ? "text-neutral-600" : ""}`}>
        {TX_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      <input className={inputCls} placeholder="Sender address or .algo" value={item.sender} disabled={disabled}
        onChange={e => update(item.id, "sender", e.target.value)} />
      {item.txType !== "optin" && (
        <div>
          <input className={inputCls} placeholder="Receiver address or .algo" value={item.receiver} disabled={disabled}
            onChange={e => update(item.id, "receiver", e.target.value)} />
          {!disabled && !item.receiver && getRecentContacts().length > 0 && (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className="text-[9px] text-neutral-600 uppercase tracking-widest">Recent:</span>
              {getRecentContacts().filter(c => c !== item.sender).slice(0, 5).map(contact => (
                <button key={contact} onClick={() => update(item.id, "receiver", contact)}
                  className="text-[10px] px-2 py-0.5 bg-neutral-800 border border-neutral-700 rounded-full text-neutral-400 hover:text-orange-400 hover:border-orange-500/30 transition-colors truncate max-w-[140px]">
                  {shorten(contact)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {item.txType !== "pay" && (
        <div className="relative" ref={dropdownRef}>
          <input
            className={inputCls}
            placeholder={assetsLoading ? "Loading assets…" : walletAssets.length > 0 ? "Search by name or ASA ID…" : "Asset ID"}
            disabled={disabled}
            value={showDropdown ? assetSearch : (item.assetId ? `${item.assetId}${assetName ? ` — ${assetName}` : ""}` : "")}
            onChange={e => {
              setAssetSearch(e.target.value);
              setShowDropdown(true);
              // If it's a pure number, also set assetId directly
              const num = Number(e.target.value);
              if (!isNaN(num) && num > 0 && String(num) === e.target.value.trim()) {
                update(item.id, "assetId", num);
              }
            }}
            onFocus={() => { setShowDropdown(true); setAssetSearch(""); }}
          />
          {assetsLoading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="w-4 h-4 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin" />
            </div>
          )}
          {showDropdown && !disabled && walletAssets.length > 0 && (
            <div className="absolute z-30 left-0 right-0 top-full mt-1 max-h-48 overflow-y-auto bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl shadow-black/50">
              {filteredAssets.length === 0 ? (
                <div className="px-3 py-2 text-neutral-600 text-xs">No assets match "{assetSearch}"</div>
              ) : (
                filteredAssets.slice(0, 50).map(a => (
                  <button
                    key={a.id}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-neutral-800 transition-colors flex items-center justify-between gap-2 ${item.assetId === a.id ? "bg-orange-500/10 text-orange-400" : "text-white"}`}
                    onClick={() => {
                      update(item.id, "assetId", a.id === 1 ? null : a.id);
                      if (a.id === 1) update(item.id, "txType", "pay");
                      setShowDropdown(false);
                      setAssetSearch("");
                    }}
                  >
                    <div className="min-w-0">
                      <span className="font-medium truncate block">{a.name || `ASA #${a.id}`}</span>
                      <span className="text-[10px] text-neutral-500">{a.unitName} · ID {a.id}</span>
                    </div>
                    <span className="text-[10px] text-neutral-600 flex-shrink-0">{a.id === 1 ? "" : `${(a.amount / Math.pow(10, a.decimals)).toLocaleString()}`}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
      {item.txType !== "optin" && (
        <input type="number" className={inputCls} placeholder={item.txType === "pay" ? "Amount (ALGO)" : "Amount"} disabled={disabled}
          value={item.amount ?? ""} onChange={e => update(item.id, "amount", e.target.value ? Number(e.target.value) : null)} min={0} />
      )}
    </div>
  );
}

// ── Claim View sub-component ─────────────────────────────────────────────
function ClaimView({ txIds }: { txIds: string[] }) {
  const { activeAddress, transactionSigner } = useWallet();
  const [decoded, setDecoded] = useState<DecodedSwapTx[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");
  const [resultTx, setResultTx] = useState("");
  const [optinsNeeded, setOptinsNeeded] = useState<number[]>([]);
  const [images, setImages] = useState<Record<number, string>>({});

  useEffect(() => {
    fetchSwapFromTxIds(txIds)
      .then(d => {
        setDecoded(d);
        d.forEach((item, i) => {
          if (item.swap.assetUrl && item.swap.assetId && item.swap.assetId > 1) {
            getNFTImageUrl(item.swap.assetUrl, item.swap.assetReserve || "").then(url => {
              if (url) setImages(prev => ({ ...prev, [i]: url }));
            }).catch(() => {});
          }
        });
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [txIds]);

  // Check opt-in status when wallet connects
  useEffect(() => {
    if (!activeAddress || !decoded) return;
    getAccountAssets(activeAddress).then(held => {
      const needed: number[] = [];
      for (const d of decoded) {
        if (d.swap.txType === "axfer" && d.swap.receiver === activeAddress && d.swap.assetId && d.swap.assetId > 1) {
          if (!held.has(d.swap.assetId)) needed.push(d.swap.assetId);
        }
      }
      setOptinsNeeded([...new Set(needed)]);
    });
  }, [activeAddress, decoded]);

  const handleClaim = async () => {
    if (!activeAddress || !decoded || !transactionSigner) return;
    setClaiming(true);
    try {
      // Auto opt-in if needed
      if (optinsNeeded.length > 0) {
        toast.info(`Auto opt-in to ${optinsNeeded.length} asset(s)…`);
        const algosdk = (await import("algosdk")).default;
        const algod = new algosdk.Algodv2("", "https://mainnet-api.4160.nodely.dev", "");
        const params = await algod.getTransactionParams().do();
        const optTxns = optinsNeeded.map(id =>
          algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
            from: activeAddress, to: activeAddress, amount: 0, assetIndex: id, suggestedParams: params,
          })
        );
        if (optTxns.length > 1) { const gid = algosdk.computeGroupID(optTxns); optTxns.forEach(t => { t.group = gid; }); }
        const signed = await transactionSigner(optTxns, optTxns.map((_, i) => i));
        await algod.sendRawTransaction(signed).do();
        toast.success("Opt-in complete!");
        setOptinsNeeded([]);
      }

      const txId = await claimSwap(decoded, transactionSigner);
      setResultTx(txId);
      toast.success("Swap claimed successfully!");
    } catch (e: any) {
      toast.error(e.message || "Claim failed");
    } finally { setClaiming(false); }
  };

  if (loading) return (
    <div className="flex flex-col items-center gap-4 py-20">
      <div className="w-8 h-8 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin" />
      <span className="text-neutral-500 text-xs font-mono uppercase tracking-widest">Decoding swap…</span>
    </div>
  );

  if (error) return <div className="text-red-400 text-center py-12 font-mono text-sm">{error}</div>;
  if (!decoded) return null;

  if (resultTx) return (
    <div className="space-y-6 text-center animate-fade-in">
      <div className="w-16 h-16 mx-auto bg-green-500/10 border border-green-500/30 rounded-full flex items-center justify-center text-3xl">✓</div>
      <h2 className="text-2xl font-black text-white">Swap Complete!</h2>
      <a href={`https://explorer.perawallet.app/tx/${resultTx}`} target="_blank" rel="noreferrer"
        className="text-orange-400 hover:text-orange-300 text-xs font-mono break-all transition-colors">{resultTx}</a>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="space-y-3">
        {decoded.map((d, i) => (
          <div key={i} className={`flex items-start gap-4 p-4 rounded-xl border ${d.isSigned ? "bg-green-500/5 border-green-500/20" : "bg-orange-500/5 border-orange-500/20"}`}>
            <div className={`w-2 h-2 mt-1.5 rounded-full flex-shrink-0 ${d.isSigned ? "bg-green-500" : "bg-orange-500 animate-pulse"}`} />
            
            {images[i] && (
              <img src={images[i]} alt="Asset" className="w-10 h-10 rounded bg-neutral-900 border border-neutral-800 object-cover flex-shrink-0" />
            )}
            
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <span className={`font-bold uppercase tracking-wider ${d.isSigned ? "text-green-400" : "text-orange-400"}`}>
                  {d.swap.txType === "pay" ? "ALGO" : d.swap.txType === "optin" ? "OPT-IN" : "ASA"} #{i + 1}
                </span>
                {d.isSigned && <span className="text-green-500/60 text-[10px]">SIGNED</span>}
                {!d.isSigned && <span className="text-orange-500/60 text-[10px]">NEEDS YOUR SIGNATURE</span>}
              </div>
              <div className="text-neutral-400 text-[11px] font-mono truncate flex items-center">
                {shorten(d.swap.sender)} → {shorten(d.swap.receiver)}
                {d.swap.txType !== "optin" && (
                  <span className="text-white ml-2 flex items-center gap-1">
                    {d.swap.amount}{" "}
                    {d.swap.assetId === 1 ? (
                      "ALGO"
                    ) : (
                      <a
                        href={`https://explorer.perawallet.app/asset/${d.swap.assetId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-orange-400 hover:text-orange-300 hover:underline transition-colors ml-0.5"
                      >
                        ASA #{d.swap.assetId} ↗
                      </a>
                    )}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {optinsNeeded.length > 0 && (
        <div className="flex items-start gap-3 p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
          <span className="text-amber-400 text-lg">⚠</span>
          <div className="text-xs text-amber-300/80">
            <p className="font-bold mb-1">Auto Opt-In Required</p>
            <p>You'll be automatically opted into {optinsNeeded.length} asset(s) before the swap executes: {optinsNeeded.join(", ")}</p>
          </div>
        </div>
      )}

      {!activeAddress ? <ConnectButton inmain={true} /> : (
        <button onClick={handleClaim} disabled={claiming}
          className="w-full py-4 bg-gradient-to-r from-orange-500 to-amber-500 text-black font-black text-sm uppercase tracking-widest rounded-xl hover:brightness-110 disabled:opacity-50 transition-all">
          {claiming ? "Signing…" : "Sign & Complete Swap"}
        </button>
      )}

      <p className="text-neutral-600 text-[10px] text-center">
        Atomic swaps have a ~45 minute validity window. If expired, the swap will fail.
      </p>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────
export default function WenSwapTool() {
  const [searchParams] = useSearchParams();
  const claimTxIds = searchParams.getAll("txid");

  if (claimTxIds.length > 0) {
    return (
      <>
        <Meta title="Claim Swap" description="Claim a peer-to-peer atomic swap on Algorand." />
        <div className="min-h-screen bg-neutral-950 text-white font-sans">
          <div className="max-w-2xl mx-auto px-6 py-16">
            <h1 className="text-4xl font-black tracking-tighter mb-2">
              <span className="text-orange-500">WEN</span>.SWAP
              <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full font-mono align-middle ml-2">CLAIM</span>
            </h1>
            <p className="text-neutral-500 text-sm font-mono tracking-tight mb-10">Review and sign the counterparty's swap.</p>
            <ClaimView txIds={claimTxIds} />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Meta title="WEN.SWAP" description="Peer-to-peer atomic swaps on Algorand. Trade assets trustlessly with no intermediary." />
      <CreateView />
    </>
  );
}

// ── Create View ──────────────────────────────────────────────────────────
function CreateView() {
  const { activeAddress, transactionSigner } = useWallet();
  type Step = "edit" | "loading" | "signed" | "sharing" | "done";
  const [step, setStep] = useState<Step>("edit");
  const [items, setItems] = useState<SwapItem[]>([
    { id: 1, sender: "", receiver: "", assetId: null, amount: null, txType: "axfer" },
    { id: 2, sender: "", receiver: "", assetId: null, amount: null, txType: "axfer" },
  ]);
  const [signedTxns, setSignedTxns] = useState<Uint8Array[] | null>(null);
  const [shareTxIds, setShareTxIds] = useState<string[]>([]);
  const [nextId, setNextId] = useState(3);

  // Auto-fill: tx1 sender = you, tx2 receiver = you
  useEffect(() => {
    if (activeAddress) {
      setItems(prev => prev.map((it, i) => {
        if (i === 0 && !it.sender) return { ...it, sender: activeAddress };
        if (i === 1 && !it.receiver) return { ...it, receiver: activeAddress };
        return it;
      }));
    }
  }, [activeAddress]);

  const update = useCallback((id: number, field: keyof SwapItem, val: any) => {
    setItems(prev => {
      const next = prev.map(it => it.id === id ? { ...it, [field]: val } : it);
      // tx1 sender → tx2 receiver, tx1 receiver → tx2 sender
      if (next.length >= 2 && id === next[0].id) {
        if (field === "sender") next[1] = { ...next[1], receiver: val };
        if (field === "receiver") next[1] = { ...next[1], sender: val };
      }
      return next;
    });
  }, []);

  const remove = useCallback((id: number) => {
    setItems(prev => prev.filter(it => it.id !== id));
  }, []);

  const addRow = () => {
    if (items.length >= MAX_SWAP_TXS) { toast.info(`Max ${MAX_SWAP_TXS} transactions.`); return; }
    setItems(prev => [...prev, { id: nextId, sender: "", receiver: "", assetId: null, amount: null, txType: "axfer" }]);
    setNextId(n => n + 1);
  };

  const handleCreate = async () => {
    if (!activeAddress || !transactionSigner) { toast.info("Connect wallet first."); return; }
    if (items.length < 2) { toast.info("Add at least 2 transactions."); return; }
    if (items.some(it => !it.txType)) { toast.info("Select a type for each transaction."); return; }

    setStep("loading");
    try {
      // Build enriched list with opt-ins inserted BEFORE each transfer that needs one
      const enrichedItems: SwapItem[] = [];
      // Cache asset holdings per party
      const holdingsCache: Record<string, Set<number>> = {};
      for (const item of items) {
        for (const addr of [item.sender, item.receiver]) {
          if (addr && !(addr in holdingsCache)) {
            holdingsCache[addr] = await getAccountAssets(addr);
          }
        }
      }
      // Walk items in order, insert opt-in before each axfer if receiver isn't opted in
      for (const item of items) {
        if (item.txType === "axfer" && item.receiver && item.assetId && item.assetId > 1) {
          const receiverHeld = holdingsCache[item.receiver] || new Set();
          if (!receiverHeld.has(item.assetId)) {
            const alreadyAdded = enrichedItems.some(e => e.txType === "optin" && e.sender === item.receiver && e.assetId === item.assetId);
            if (!alreadyAdded) {
              enrichedItems.push({
                id: nextId + enrichedItems.length, sender: item.receiver, receiver: item.receiver,
                assetId: item.assetId, amount: 0, txType: "optin",
              });
              toast.info(`Auto-added opt-in for ${shorten(item.receiver)} → ASA #${item.assetId}`);
            }
          }
        }
        enrichedItems.push(item);
      }

      const txns = await buildSwapGroup(enrichedItems);
      const indices = txns.map((_, i) => i).filter(i => {
        const from = enrichedItems[i]?.sender;
        return from === activeAddress || (from && from.endsWith(".algo"));
      });

      const signed = await transactionSigner(txns, indices);

      // Merge signed with unsigned
      const merged: Uint8Array[] = [];
      let si = 0;
      for (let i = 0; i < txns.length; i++) {
        if (indices.includes(i)) merged.push(signed[si++]);
        else merged.push(txns[i].toByte());
      }

      setSignedTxns(merged);
      setItems(enrichedItems);
      setStep("signed");
      // Save counterparty addresses to recent contacts
      const allAddrs = new Set(enrichedItems.flatMap(it => [it.sender, it.receiver]).filter(a => a && a !== activeAddress));
      allAddrs.forEach(a => saveContact(a));
      toast.success("Swap transactions created!");
    } catch (e: any) {
      toast.error(e.message || "Failed to create swap.");
      setStep("edit");
    }
  };

  const handleShare = async () => {
    if (!activeAddress || !transactionSigner || !signedTxns) return;
    setStep("sharing");
    try {
      const ids = await createShareTx(activeAddress, signedTxns, transactionSigner);
      setShareTxIds(ids);
      setStep("done");
      toast.success("Share transaction sent!");
    } catch (e: any) {
      toast.error(e.message || "Failed to share.");
      setStep("signed");
    }
  };

  const claimUrl = `${window.location.origin}/wen-swap?txid=${shareTxIds.join("&txid=")}`;

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans selection:bg-orange-500/30">
      <div className="max-w-2xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-4xl font-black tracking-tighter mb-2">
            <span className="text-orange-500">WEN</span>.SWAP
          </h1>
          <p className="text-neutral-500 text-sm font-mono tracking-tight">Trustless peer-to-peer atomic swaps on Algorand.</p>
        </div>

        {!activeAddress && <ConnectButton inmain={true} />}

        {step === "done" ? (
          <div className="space-y-6 animate-fade-in text-center">
            <div className="w-16 h-16 mx-auto bg-green-500/10 border border-green-500/30 rounded-full flex items-center justify-center text-3xl">✓</div>
            <h2 className="text-2xl font-black">Swap Created!</h2>
            <p className="text-neutral-400 text-sm">Share this link with the counterparty:</p>
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
              <code className="text-orange-400 text-xs break-all">{claimUrl}</code>
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={() => { navigator.clipboard.writeText(claimUrl); toast.info("Copied!"); }}
                className="px-6 py-3 bg-orange-500 text-black font-bold text-xs uppercase tracking-widest rounded-xl hover:brightness-110 transition">
                Copy Link
              </button>
              <a href={claimUrl} className="px-6 py-3 bg-neutral-800 text-neutral-300 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-neutral-700 transition">
                Open Claim Page
              </a>
            </div>
            <p className="text-red-400/60 text-[10px]">⚠ Swap is valid for ~45 minutes. Do not modify the URL.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Info Banner */}
            <div className="bg-neutral-900/50 border border-neutral-800 rounded-xl p-4 text-xs text-neutral-500 space-y-1">
              <p>Add 2–{MAX_SWAP_TXS} transactions. Algorand atomic transfers execute as an all-or-nothing group.</p>
              <p className="text-amber-400/60">⏱ Swaps are valid for ~1000 rounds (~45 min). Opt-ins are added automatically.</p>
            </div>

            {/* Transaction Rows */}
            {items.map((item, i) => (
              <TxRow key={item.id} item={item} index={i} total={items.length} update={update} remove={remove} disabled={step !== "edit"} />
            ))}

            {/* Add Button */}
            {step === "edit" && (
              <button onClick={addRow} disabled={items.length >= MAX_SWAP_TXS}
                className="w-full py-3 border border-dashed border-neutral-700 rounded-xl text-neutral-500 text-xs font-bold uppercase tracking-widest hover:border-orange-500/50 hover:text-orange-400 disabled:opacity-30 transition-colors">
                + Add Transaction
              </button>
            )}

            {/* Actions */}
            <div className="pt-4 border-t border-neutral-800">
              {step === "loading" || step === "sharing" ? (
                <div className="flex flex-col items-center gap-3 py-6">
                  <div className="w-8 h-8 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin" />
                  <span className="text-neutral-500 text-xs font-mono uppercase tracking-widest">
                    {step === "loading" ? "Creating swap…" : "Broadcasting share tx…"}
                  </span>
                </div>
              ) : step === "signed" ? (
                <button onClick={handleShare}
                  className="w-full py-4 bg-gradient-to-r from-orange-500 to-amber-500 text-black font-black text-sm uppercase tracking-widest rounded-xl hover:brightness-110 transition-all">
                  Share Swap (Send to Chain)
                </button>
              ) : activeAddress ? (
                <button onClick={handleCreate} disabled={items.length < 2}
                  className="w-full py-4 bg-gradient-to-r from-orange-500 to-amber-500 text-black font-black text-sm uppercase tracking-widest rounded-xl hover:brightness-110 disabled:opacity-40 transition-all">
                  Create & Sign Swap
                </button>
              ) : null}
            </div>
          </div>
        )}

        {/* Practitioner Section: SEO-rich content for crawlers */}
        <section className="mt-20 pt-12 border-t border-neutral-800">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <div className="space-y-3">
              <h2 className="text-lg font-bold text-white italic">Atomic Guarantees</h2>
              <p className="text-sm text-neutral-500 leading-relaxed">
                Algorand's layer-1 atomic transfers ensure all-or-nothing execution. Either every transaction in the swap succeeds, or none do — eliminating counterparty risk entirely. WEN.SWAP leverages this native protocol feature to provide trustless peer-to-peer trading without intermediaries, order books, or liquidity pools.
              </p>
            </div>
            <div className="space-y-3">
              <h2 className="text-lg font-bold text-white italic">Auto Opt-In</h2>
              <p className="text-sm text-neutral-500 leading-relaxed">
                WEN.SWAP automatically detects when a party hasn't opted into a required Algorand Standard Asset (ASA) and injects the opt-in transaction into the atomic group — no manual setup needed. This eliminates the most common friction point in Algorand P2P trades.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mt-12">
            <div className="space-y-3">
              <h2 className="text-lg font-bold text-white italic">Serverless Architecture</h2>
              <p className="text-sm text-neutral-500 leading-relaxed">
                Swap data is stored entirely on-chain using Algorand transaction notes. No backend servers, no databases, no APIs — the Algorand ledger is the only source of truth. Share a claim link and the counterparty can complete the swap from any browser.
              </p>
            </div>
            <div className="space-y-3">
              <h2 className="text-lg font-bold text-white italic">NFD Name Resolution</h2>
              <p className="text-sm text-neutral-500 leading-relaxed">
                Enter human-readable .algo domain names instead of 58-character addresses. WEN.SWAP resolves NFD (Non-Fungible Domain) names to deposit accounts automatically, reducing errors and improving the trading experience.
              </p>
            </div>
          </div>
        </section>
        {/* Developer Integration Section */}
        <section className="mt-20 pt-12 border-t border-neutral-800">
          <div className="mb-8">
            <h2 className="text-xl font-black uppercase tracking-widest text-white italic mb-2">Developer Integration</h2>
            <p className="text-sm text-neutral-500 leading-relaxed max-w-3xl">
              Integrate WEN.SWAP into your Discord bots or dApps. Swaps are transmitted statelessly by encoding msgpack-signed transactions into the <code className="text-orange-400 bg-orange-500/10 px-1 py-0.5 rounded">note</code> field of a 0-ALGO payment transaction. The format is a header with transaction lengths followed by the concatenated msgpack bytes: <code className="text-orange-400 bg-orange-500/10 px-1 py-0.5 rounded">count:len1:len2$bytes</code>.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Python Snippet */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden flex flex-col">
              <div className="bg-neutral-950 px-4 py-2 border-b border-neutral-800 flex justify-between items-center">
                <span className="text-xs font-bold text-neutral-400 uppercase tracking-widest">Python (pyteal/algosdk)</span>
              </div>
              <div className="p-4 overflow-x-auto">
                <pre className="text-xs text-neutral-300 font-mono leading-relaxed">
{`import msgpack
from algosdk import transaction

def generate_swap_shop_note(txns: list[transaction.Transaction]):
    # 1. Convert to msgpack bytes
    encoded = [msgpack.packb(t.dictify()) for t in txns]
    
    # 2. Build header: "count:len1:len2$"
    lengths = [len(t) for t in encoded]
    header = f"{len(encoded)}:{':'.join(map(str, lengths))}$"
    
    # 3. Concatenate header + bytes
    return bytearray(header.encode("utf-8") + b"".join(encoded))`}
                </pre>
              </div>
            </div>

            {/* TypeScript Snippet */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden flex flex-col">
              <div className="bg-neutral-950 px-4 py-2 border-b border-neutral-800 flex justify-between items-center">
                <span className="text-xs font-bold text-neutral-400 uppercase tracking-widest">TypeScript (algosdk)</span>
              </div>
              <div className="p-4 overflow-x-auto">
                <pre className="text-xs text-neutral-300 font-mono leading-relaxed">
{`import algosdk from "algosdk";

function generateSwapNote(txns: Uint8Array[]): Uint8Array {
  // txns should be algosdk.encodeUnsignedTransaction() 
  // or signed transaction bytes
  const count = txns.length;
  const lengths = txns.map(t => t.length).join(':');
  const headerStr = \`\${count}:\${lengths}$\`;
  const headerBytes = new TextEncoder().encode(headerStr);
  
  const totalLength = headerBytes.length + 
                      txns.reduce((sum, t) => sum + t.length, 0);
  const result = new Uint8Array(totalLength);
  
  result.set(headerBytes, 0);
  let offset = headerBytes.length;
  for (const t of txns) {
    result.set(t, offset);
    offset += t.length;
  }
  return result;
}`}
                </pre>
              </div>
            </div>
          </div>
          
          <div className="mt-6 bg-orange-500/5 border border-orange-500/20 rounded-xl p-4">
             <p className="text-xs text-orange-400/80 leading-relaxed">
              <strong className="text-orange-400">Note:</strong> Algorand transaction notes are limited to 1,000 bytes. If your combined swap group exceeds this limit, chunk the bytes into multiple 0-ALGO payment transactions to the same receiver, group them, and pass all transaction IDs in the share URL (e.g. <code className="text-orange-300">?txid=A&txid=B</code>).
             </p>
          </div>
        </section>
      </div>
    </div>
  );
}
