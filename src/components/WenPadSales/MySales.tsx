import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "@txnlab/use-wallet-react";
import { toast } from "react-toastify";
import type algosdk from "algosdk";
import {
  STATUS,
  algoToMicro,
  buildDeleteItemPages,
  buildDeleteSale,
  buildSaleAction,
  buildSetEndRound,
  buildSetPrice,
  buildUpdateMetadata,
  dateToRound,
  getCurrentRound,
  getFactoryId,
  getPayouts,
  getSaleState,
  listSales,
  roundToDate,
  saveLaunchProgress,
  signAndSend,
  type PayoutSplit,
  type SaleListing,
  type SaleNetwork,
  type SaleState,
} from "../../utils/wenpadSale";
import {
  FieldLabel,
  Notice,
  Panel,
  ProgressBar,
  StatusBadge,
  formatAlgo,
  inputClass,
  roundsToRelative,
  secondaryButtonClass,
  shortAddr,
} from "./shared";

export function MySales({ network, onResume }: { network: SaleNetwork; onResume: () => void }) {
  const { activeAddress } = useWallet();
  const factoryId = getFactoryId(network);
  const [sales, setSales] = useState<SaleListing[]>([]);
  const [currentRound, setCurrentRound] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!activeAddress || !factoryId) return;
    setLoading(true);
    try {
      const [all, round] = await Promise.all([listSales(network, factoryId), getCurrentRound(network)]);
      setSales(all.filter((s) => s.admin === activeAddress || s.distribution === activeAddress));
      setCurrentRound(round);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [network, factoryId, activeAddress]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!activeAddress) return <Notice tone="info">Connect your admin wallet to manage your sales.</Notice>;
  if (loading) return <div className="w-full max-w-3xl h-48 rounded-3xl bg-banner-grey/30 animate-pulse" />;
  if (sales.length === 0) {
    return <Notice tone="info">No shuffles found for {shortAddr(activeAddress)} on {network}.</Notice>;
  }

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-4 text-left">
      {sales.map((sale) => (
        <ManageSale
          key={sale.appId}
          network={network}
          factoryId={factoryId}
          sale={sale}
          currentRound={currentRound}
          onChange={refresh}
          onResume={onResume}
        />
      ))}
    </div>
  );
}

function ManageSale({
  network,
  factoryId,
  sale,
  currentRound,
  onChange,
  onResume,
}: {
  network: SaleNetwork;
  factoryId: number;
  sale: SaleListing;
  currentRound: number;
  onChange: () => void;
  onResume: () => void;
}) {
  const { activeAddress, transactionSigner } = useWallet();
  const [state, setState] = useState<SaleState | null>(null);
  const [payouts, setPayouts] = useState<PayoutSplit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newMetadataUrl, setNewMetadataUrl] = useState(sale.metadata.metadataUrl);

  useEffect(() => {
    getSaleState(network, sale.appId).then(setState).catch(console.error);
    getPayouts(network, sale.appId).then(setPayouts);
  }, [network, sale.appId, sale.status, sale.sold]);

  const run = async (label: string, build: () => Promise<algosdk.Transaction[] | algosdk.Transaction[][]>) => {
    if (!activeAddress) return;
    setBusy(label);
    try {
      const built = await build();
      const groups = Array.isArray(built[0]) ? (built as algosdk.Transaction[][]) : [built as algosdk.Transaction[]];
      for (const group of groups) await signAndSend(network, group, transactionSigner);
      toast.success(`${label} done`);
      setState(await getSaleState(network, sale.appId));
      onChange();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || `${label} failed`);
    } finally {
      setBusy("");
    }
  };

  const ended = currentRound > sale.endRound;
  const released = sale.status === STATUS.RELEASED;
  const isManager = activeAddress === sale.admin;
  // Anyone may release once the sale has ended or sold out; the manager may release any time
  const canRelease = isManager || ended || (state?.remaining ?? 1) === 0;

  const resumeSetup = () => {
    if (!state || !activeAddress) return;
    saveLaunchProgress({
      network,
      admin: state.admin,
      distribution: state.distribution,
      saleId: sale.saleId,
      appId: sale.appId,
      assetIds: [],
      itemsAdded: state.total,
    });
    onResume();
  };

  const closeSale = async () => {
    if (!confirm("Close this Shuffle? This frees its storage, deletes the Shuffle app and refunds all deposits.")) return;
    await run("Free item storage", () => buildDeleteItemPages(network, activeAddress!, sale.appId));
    await run("Close Shuffle", () => buildDeleteSale(network, factoryId, activeAddress!, sale.saleId));
  };

  return (
    <Panel className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-black text-white truncate">{sale.metadata.name}</h3>
            <StatusBadge status={sale.status} ended={ended} />
          </div>
          <p className="text-xs text-gray-500">
            Shuffle #{sale.saleId} · app {sale.appId} · {formatAlgo(sale.price, 3)}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link to={`/shuffle/${sale.appId}`} className={secondaryButtonClass}>
            View
          </Link>
          <button onClick={() => setOpen(!open)} className={secondaryButtonClass}>
            {open ? "Close" : "Manage"}
          </button>
        </div>
      </div>

      <div>
        <div className="flex justify-between text-xs text-gray-400 font-bold mb-1.5">
          <span>
            {sale.sold} / {sale.totalItems} sold
          </span>
          <span>
            {ended ? "Ended" : "Ends"} {roundsToRelative(sale.endRound, currentRound)}
          </span>
        </div>
        <ProgressBar value={sale.sold} total={sale.totalItems} />
      </div>

      {open && state && (
        <div className="space-y-4 border-t border-white/[0.08] pt-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
            <Stat label="Volume" value={formatAlgo(sale.volume, 3)} />
            <Stat label="Unwithdrawn" value={formatAlgo(state.proceeds, 3)} />
            <Stat label="Remaining" value={String(state.remaining)} />
            <Stat label="Pending reveals" value={String(state.pending)} />
            <Stat label="Manager" value={shortAddr(state.admin)} />
          </div>

          {payouts.length > 0 && (
            <div className="text-xs space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Payout split</p>
              {payouts.map((p) => (
                <div key={p.address} className="flex justify-between text-gray-300">
                  <span className="font-mono">{shortAddr(p.address)}</span>
                  <span className="font-bold">{p.bps / 100}%</span>
                </div>
              ))}
            </div>
          )}

          {sale.status === STATUS.SETUP && activeAddress === sale.distribution && (
            <Notice tone="warn">
              This Shuffle has not gone live.{" "}
              <button onClick={resumeSetup} className="font-bold underline">
                Resume setup
              </button>{" "}
              to finish loading items and rekey your collection wallet, or have the manager release it to cancel.
            </Notice>
          )}

          {!isManager && !released && (
            <Notice tone="info">
              Connect the manager wallet ({shortAddr(sale.admin)}) to pause, change the price or end date, or release
              the Shuffle early.
            </Notice>
          )}

          <div className="flex flex-wrap gap-2">
            {isManager && sale.status === STATUS.LIVE && (
              <button
                disabled={!!busy}
                onClick={() => run("Pause", () => buildSaleAction(network, activeAddress!, sale.appId, "pause"))}
                className={secondaryButtonClass}
              >
                Pause
              </button>
            )}
            {isManager && sale.status === STATUS.PAUSED && (
              <button
                disabled={!!busy}
                onClick={() => run("Unpause", () => buildSaleAction(network, activeAddress!, sale.appId, "unpause"))}
                className={secondaryButtonClass}
              >
                Unpause
              </button>
            )}
            {state.proceeds > 0 && (
              <button
                disabled={!!busy}
                onClick={() =>
                  run("Withdraw proceeds", () => buildSaleAction(network, activeAddress!, sale.appId, "withdrawProceeds"))
                }
                className={secondaryButtonClass}
              >
                Withdraw {formatAlgo(state.proceeds, 3)}
              </button>
            )}
            {!released && canRelease && (
              <button
                disabled={!!busy || state.pending > 0}
                title={state.pending > 0 ? "Pause first and wait for pending reveals" : undefined}
                onClick={() => {
                  if (confirm("Release the collection wallet? This ends the Shuffle and rekeys the wallet back to itself.")) {
                    run("Release", () => buildSaleAction(network, activeAddress!, sale.appId, "release"));
                  }
                }}
                className={secondaryButtonClass}
              >
                Release wallet & end Shuffle
              </button>
            )}
            {released && (
              <button disabled={!!busy} onClick={closeSale} className={secondaryButtonClass}>
                Close Shuffle & reclaim deposits
              </button>
            )}
          </div>
          {!released && state.pending > 0 && (
            <p className="text-[11px] text-gray-500">
              Release needs zero pending reveals. Pause the Shuffle first; pending mints are revealed within seconds.
            </p>
          )}

          {isManager && !released && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel>New price (ALGO)</FieldLabel>
                <div className="flex gap-2">
                  <input type="number" className={inputClass} value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
                  <button
                    disabled={!!busy || newPrice === ""}
                    onClick={() =>
                      run("Update price", () =>
                        buildSetPrice(network, activeAddress!, sale.appId, algoToMicro(Number(newPrice)))
                      )
                    }
                    className={secondaryButtonClass}
                  >
                    Set
                  </button>
                </div>
              </div>
              <div>
                <FieldLabel hint={`now ${roundToDate(sale.endRound, currentRound).toLocaleDateString()}`}>
                  New end
                </FieldLabel>
                <div className="flex gap-2">
                  <input type="datetime-local" className={inputClass} value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
                  <button
                    disabled={!!busy || !newEnd}
                    onClick={() =>
                      run("Update end", async () =>
                        buildSetEndRound(network, activeAddress!, sale.appId, dateToRound(new Date(newEnd), await getCurrentRound(network)))
                      )
                    }
                    className={secondaryButtonClass}
                  >
                    Set
                  </button>
                </div>
              </div>
            </div>
          )}

          {isManager && (
          <div>
            <FieldLabel>Collection metadata URL</FieldLabel>
            <div className="flex gap-2">
              <input className={inputClass} value={newMetadataUrl} onChange={(e) => setNewMetadataUrl(e.target.value.trim())} />
              <button
                disabled={!!busy || newMetadataUrl === sale.metadata.metadataUrl}
                onClick={() =>
                  run("Update metadata", () =>
                    buildUpdateMetadata(network, factoryId, activeAddress!, sale.saleId, {
                      ...sale.metadata,
                      metadataUrl: newMetadataUrl,
                    })
                  )
                }
                className={secondaryButtonClass}
              >
                Save
              </button>
            </div>
          </div>
          )}

          {busy && <p className="text-xs text-gray-400">{busy}…</p>}
        </div>
      )}
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-asset-detail-bg/50 border border-white/[0.08] rounded-2xl p-3">
      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">{label}</p>
      <p className="text-sm font-bold text-white mt-0.5">{value}</p>
    </div>
  );
}
