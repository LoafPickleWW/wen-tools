import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@txnlab/use-wallet-react";
import algosdk from "algosdk";
import QRCode from "qrcode";
import { toast } from "react-toastify";
import { IoCopy, IoDownload, IoPlay, IoPrint, IoStop, IoTrash } from "react-icons/io5";
import { Callout, TermSpinner, ToolHero } from "../components/cypher/ToolKit";
import { Meta } from "../components/Meta";
import { generateNativePQAccount, nativePQFee } from "../utils/pqNative";
import {
  clearSession,
  countPrinted,
  estimatePrints,
  fetchBalance,
  findFunder,
  getPrinterAlgod,
  loadSession,
  runPrinter,
  saveSession,
  type PrinterNetwork,
  type PrinterSession,
  type Receipt,
} from "../utils/pqPrinter";
import {
  getExplorerAddressUrl,
  getExplorerTxUrl,
  microAlgosToAlgos,
  algosToMicroAlgos,
} from "../utils/falcon";

/** Receipts kept on screen; counters track the full run. */
const TAPE_LENGTH = 300;
const MIN_FEE = 1000;
/** Bytes a Falcon-1024 public key adds to every PQ transaction. */
const PQ_PUBLIC_KEY_BYTES = 1793;

type Phase = "idle" | "printing" | "closing" | "done";

interface Stats {
  submitted: number;
  confirmed: number;
  failed: number;
  sigBytes: number;
  startedAt: number | null;
  lastRound: number | null;
}

const EMPTY_STATS: Stats = {
  submitted: 0,
  confirmed: 0,
  failed: 0,
  sigBytes: 0,
  startedAt: null,
  lastRound: null,
};

function short(s: string, n = 6) {
  return s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-n)}` : s;
}

export default function PQTxPrinter() {
  const { activeAddress, activeNetwork, signTransactions } = useWallet();
  const walletNetwork: PrinterNetwork = activeNetwork === "testnet" ? "testnet" : "mainnet";

  const [session, setSession] = useState<PrinterSession | null>(() => loadSession());
  const [generating, setGenerating] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [minBalance, setMinBalance] = useState(100_000);
  const [fundAmount, setFundAmount] = useState("1");
  const [funding, setFunding] = useState(false);
  const [refundTo, setRefundTo] = useState(session?.refundTo ?? "");
  const [phase, setPhase] = useState<Phase>(session?.closed ? "done" : "idle");
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [refunded, setRefunded] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef(session);
  const qrRef = useRef<HTMLCanvasElement>(null);

  const updateSession = useCallback((patch: Partial<PrinterSession>) => {
    if (!sessionRef.current) return;
    const next = { ...sessionRef.current, ...patch };
    sessionRef.current = next;
    saveSession(next);
    setSession(next);
  }, []);

  // ── Balance polling while idle (detects funding from any wallet) ──────────
  const refreshBalance = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    try {
      const b = await fetchBalance(s.network, s.account.address);
      setBalance(b.amount);
      setMinBalance(b.minBalance);
    } catch {
      // transient node error, next poll retries
    }
  }, []);

  useEffect(() => {
    if (!session || phase === "printing" || phase === "closing") return;
    refreshBalance();
    if (phase === "done") return;
    const t = setInterval(refreshBalance, 5000);
    return () => clearInterval(t);
  }, [session?.account.address, phase, refreshBalance]);

  // Default the refund address to the connected wallet, or whoever funded the printer.
  useEffect(() => {
    if (!session || refundTo) return;
    if (activeAddress && session.network === walletNetwork) {
      setRefundTo(activeAddress);
    } else if (balance && balance > 0) {
      findFunder(session.network, session.account.address).then((a) => a && setRefundTo(a));
    }
  }, [session, activeAddress, walletNetwork, balance, refundTo]);

  useEffect(() => {
    if (qrRef.current && session) {
      QRCode.toCanvas(qrRef.current, session.account.address, {
        width: 148,
        margin: 1,
        color: { dark: "#000000", light: "#ffffff" },
      });
    }
  }, [session?.account.address, phase]);

  useEffect(() => {
    if (phase !== "printing") return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [phase]);

  // Stop the printer if the page unmounts mid-run.
  useEffect(() => () => abortRef.current?.abort(), []);

  // The ledger is the only reliable lifetime count (runs can be cut short by a reload).
  const [totalPrinted, setTotalPrinted] = useState<number | null>(null);
  useEffect(() => {
    if (phase !== "done" || !session) return;
    setTotalPrinted(null);
    // Give the indexer a moment to catch up with the close-out round.
    const t = setTimeout(() => {
      countPrinted(session.network, session.account.address)
        .then(setTotalPrinted)
        .catch(() => setTotalPrinted(stats.confirmed));
    }, 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, session?.account.address]);

  // Leaving mid-run stops the printer (it can be resumed), so ask first.
  useEffect(() => {
    if (phase !== "printing" && phase !== "closing") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const account = await generateNativePQAccount();
      const next: PrinterSession = {
        version: 1,
        network: walletNetwork,
        account,
        refundTo: "",
        createdAt: Date.now(),
        nextSeq: 1,
      };
      sessionRef.current = next;
      saveSession(next);
      setSession(next);
      setBalance(0);
      setRefundTo(activeAddress ?? "");
      setReceipts([]);
      setStats(EMPTY_STATS);
      setRefunded(null);
      setError(null);
      setPhase("idle");
    } catch (err: any) {
      toast.error(`Key generation failed: ${err?.message ?? err}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleFund = async () => {
    if (!session || !activeAddress) return;
    const amount = algosToMicroAlgos(fundAmount);
    if (!amount || amount < 200_000) {
      toast.error("Send at least 0.2 ALGO (0.1 is the account minimum balance).");
      return;
    }
    setFunding(true);
    try {
      const algod = getPrinterAlgod(session.network);
      const sp = await algod.getTransactionParams().do();
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: activeAddress,
        to: session.account.address,
        amount,
        note: new TextEncoder().encode("wen.tools PQ printer · load paper"),
        suggestedParams: sp,
      });
      const [signed] = await signTransactions([algosdk.encodeUnsignedTransaction(txn)]);
      if (!signed) throw new Error("Signing cancelled");
      await algod.sendRawTransaction(signed).do();
      await algosdk.waitForConfirmation(algod, txn.txID().toString(), 10);
      toast.success(`Loaded ${fundAmount} ALGO into the printer`);
      if (!refundTo) setRefundTo(activeAddress);
      await refreshBalance();
    } catch (err: any) {
      toast.error(err?.message ?? String(err));
    } finally {
      setFunding(false);
    }
  };

  const handlePrint = async () => {
    const s = sessionRef.current;
    if (!s) return;
    if (!algosdk.isValidAddress(refundTo)) {
      toast.error("Enter a valid refund address for the leftover minimum balance.");
      return;
    }
    if (refundTo === s.account.address) {
      toast.error("The refund address can't be the printer itself.");
      return;
    }
    updateSession({ refundTo });

    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setPhase("printing");
    setStats((st) => ({ ...st, startedAt: st.startedAt ?? Date.now() }));

    const markReceipts = (ids: string[], patch: Partial<Receipt>) => {
      const set = new Set(ids);
      setReceipts((rs) => rs.map((r) => (set.has(r.txID) ? { ...r, ...patch } : r)));
    };

    try {
      const result = await runPrinter(sessionRef.current!, controller.signal, {
        onSubmitted: (batch) => {
          if (batch.some((r) => r.close)) setPhase("closing");
          setReceipts((rs) => [...[...batch].reverse(), ...rs].slice(0, TAPE_LENGTH));
          setStats((st) => ({
            ...st,
            submitted: st.submitted + batch.length,
            sigBytes: st.sigBytes + batch.reduce((n, r) => n + r.sigBytes, 0),
          }));
        },
        onConfirmed: (ids, round) => {
          markReceipts(ids, { status: "confirmed", round });
          setStats((st) => ({ ...st, confirmed: st.confirmed + ids.length, lastRound: round }));
        },
        onFailed: (ids, msg) => {
          markReceipts(ids, { status: "failed" });
          setStats((st) => ({ ...st, failed: st.failed + ids.length }));
          setError(msg);
        },
        onBalance: setBalance,
        onSeq: (nextSeq) => updateSession({ nextSeq }),
      });

      if (result.closed) {
        updateSession({ closed: true });
        setRefunded(result.refunded ?? 0);
        setPhase("done");
        toast.success("Out of paper: printer closed out and refunded.");
      } else {
        setPhase("idle");
      }
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setPhase("idle");
      refreshBalance();
    } finally {
      abortRef.current = null;
    }
  };

  const handleStop = () => abortRef.current?.abort();

  const handleBackup = () => {
    if (!session) return;
    const blob = new Blob([JSON.stringify({ type: "native-pq-falcon1024", ...session }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pq-printer-${session.account.address.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDiscard = () => {
    if (
      balance &&
      balance > 0 &&
      !session?.closed &&
      !window.confirm(
        `This printer still holds ${microAlgosToAlgos(balance)} ALGO. Discarding the key loses those funds forever. Continue?`,
      )
    ) {
      return;
    }
    clearSession();
    sessionRef.current = null;
    setSession(null);
    setBalance(null);
    setRefundTo("");
    setReceipts([]);
    setStats(EMPTY_STATS);
    setRefunded(null);
    setError(null);
    setPhase("idle");
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const fee = nativePQFee(MIN_FEE);
  const printsLeft = balance === null ? 0 : estimatePrints(balance, minBalance, MIN_FEE);
  const fundPreview = estimatePrints(algosToMicroAlgos(fundAmount) || 0, 100_000, MIN_FEE);
  const elapsed = stats.startedAt ? Math.max(1, (now - stats.startedAt) / 1000) : 0;
  const tps = elapsed ? stats.confirmed / elapsed : 0;
  const networkMismatch = !!session && session.network !== walletNetwork;
  const busy = phase === "printing" || phase === "closing";

  const statTiles = useMemo(
    () => [
      { label: "PQ txns confirmed", value: stats.confirmed.toLocaleString() },
      { label: "in flight", value: Math.max(0, stats.submitted - stats.confirmed - stats.failed).toLocaleString() },
      { label: "fees burned", value: `${microAlgosToAlgos(stats.confirmed * fee).replace(/0+$/, "").replace(/\.$/, "")} A` },
      {
        label: "Falcon bytes on-chain",
        value: `${((stats.sigBytes + stats.submitted * PQ_PUBLIC_KEY_BYTES) / 1024).toFixed(1)} KB`,
      },
      { label: "throughput", value: `${tps.toFixed(1)} tx/s` },
      { label: "last round", value: stats.lastRound?.toLocaleString() ?? "–" },
    ],
    [stats, fee, tps],
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto mb-4 flex min-h-screen w-full max-w-4xl flex-col items-center px-4 text-white">
      <Meta
        title="PQ Tx Printer"
        description="Fund a native Falcon-1024 post-quantum Algorand account and watch it print 0-Algo quantum-safe transactions until it runs out of fees."
      />
      <ToolHero
        icon={<IoPrint aria-hidden="true" />}
        tag="post-quantum"
        title="PQ Tx Printer"
        description="Feed it ALGO. It prints post-quantum transactions until the fees run dry."
        meta={["Falcon-1024", "native PQ accounts", "Algorand 5.0", "client-side"]}
      />

      <Callout label="how it works">
        Your browser generates a <strong className="text-white">Falcon-1024</strong> keypair and derives a
        native post-quantum Algorand address from it. No LogicSig and no padding transactions: since
        Algorand 5.0 the ledger verifies a lattice-based signature on every transaction directly. Each
        print is a 0-ALGO self-payment costing{" "}
        <strong className="text-primary-yellow">{microAlgosToAlgos(fee).replace(/0+$/, "")} ALGO</strong>{" "}
        (min fee + PQ surcharge). When the balance can't cover another one, the printer closes the
        account and refunds the 0.1 ALGO minimum balance.
      </Callout>

      {!session ? (
        <section className="mt-8 flex w-full flex-col items-center gap-4 rounded-2xl border border-white/[0.07] bg-banner-grey/50 p-8 text-center backdrop-blur">
          <IoPrint className="text-5xl text-primary-orange" aria-hidden="true" />
          <h2 className="text-xl font-bold">Install a new printer</h2>
          <p className="max-w-md text-sm text-slate-400">
            Creates a fresh native PQ account on{" "}
            <strong className="text-white">{walletNetwork}</strong> (switch networks in the header).
            The key stays in this browser.
          </p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 rounded-xl bg-primary-yellow px-6 py-3 font-bold text-black transition hover:bg-primary-orange disabled:opacity-60"
          >
            {generating ? <TermSpinner /> : <>Generate PQ account</>}
          </button>
        </section>
      ) : (
        <>
          {networkMismatch && (
            <div className="mt-6 w-full">
              <Callout tone="warn" label="network">
                This printer lives on <strong>{session.network}</strong> but the header is set to{" "}
                <strong>{walletNetwork}</strong>. Printing still works; switch the header to fund it from
                your wallet.
              </Callout>
            </div>
          )}

          {/* Printer account */}
          <section className="mt-6 grid w-full grid-cols-1 gap-4 md:grid-cols-[auto_1fr]">
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-white/[0.07] bg-banner-grey/50 p-4">
              <div className="rounded-xl bg-white p-1.5">
                <canvas ref={qrRef} />
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500">
                send ALGO from any wallet
              </span>
            </div>

            <div className="flex min-w-0 flex-col gap-4 rounded-2xl border border-white/[0.07] bg-banner-grey/50 p-5">
              <div>
                <span className="wt-label">( printer address · {session.network} )</span>
                <div className="mt-2 flex items-center gap-1.5">
                  <a
                    href={getExplorerAddressUrl(session.account.address, session.network)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 break-all rounded-lg bg-primary-black/60 px-3 py-2 font-mono text-xs text-slate-300 hover:text-primary-yellow"
                  >
                    {session.account.address}
                  </a>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(session.account.address);
                      toast.success("Address copied");
                    }}
                    title="Copy address"
                    className="rounded-lg p-2 text-slate-500 transition hover:bg-white/5 hover:text-white"
                  >
                    <IoCopy />
                  </button>
                </div>
                <p className="mt-1.5 font-mono text-[11px] text-slate-500">
                  scheme f1 · salt {session.account.salt} · pk {PQ_PUBLIC_KEY_BYTES} B
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/[0.06] bg-primary-black/40 p-3">
                  <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500">balance</span>
                  <span className="text-lg font-bold tabular-nums">
                    {balance === null ? "…" : `${microAlgosToAlgos(balance)} A`}
                  </span>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-primary-black/40 p-3">
                  <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500">prints left</span>
                  <span className="text-lg font-bold tabular-nums text-primary-yellow">
                    {printsLeft.toLocaleString()}
                  </span>
                </div>
              </div>

              {phase !== "done" && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="flex flex-1 items-center rounded-xl border border-white/10 bg-primary-black/40 focus-within:border-primary-orange/50">
                    <input
                      type="number"
                      min="0.2"
                      step="0.1"
                      value={fundAmount}
                      onChange={(e) => setFundAmount(e.target.value)}
                      disabled={funding}
                      aria-label="ALGO to load"
                      className="w-full bg-transparent px-3 py-2.5 text-sm tabular-nums outline-none"
                    />
                    <span className="whitespace-nowrap pr-3 font-mono text-[11px] text-slate-500">
                      ALGO ≈ {fundPreview.toLocaleString()} prints
                    </span>
                  </div>
                  <button
                    onClick={handleFund}
                    disabled={!activeAddress || networkMismatch || funding || busy}
                    title={!activeAddress ? "Connect a wallet to fund from here" : undefined}
                    className="rounded-xl border border-primary-orange/40 px-4 py-2.5 text-sm font-semibold text-primary-orange transition hover:bg-primary-orange/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {funding ? "Loading…" : activeAddress ? "Load from wallet" : "Connect wallet to load"}
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Controls */}
          {phase !== "done" && (
            <section className="mt-4 flex w-full flex-col gap-3 rounded-2xl border border-white/[0.07] bg-banner-grey/50 p-5">
              <label className="flex flex-col gap-1.5">
                <span className="wt-label">( refund leftover min balance to )</span>
                <input
                  value={refundTo}
                  onChange={(e) => setRefundTo(e.target.value.trim())}
                  disabled={busy}
                  placeholder="Algorand address"
                  className="rounded-xl border border-white/10 bg-primary-black/40 px-3 py-2.5 font-mono text-xs outline-none focus:border-primary-orange/50"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {busy ? (
                  <>
                    <button
                      onClick={handleStop}
                      disabled={phase === "closing"}
                      className="flex items-center gap-2 rounded-xl bg-red-500/90 px-6 py-3 font-bold text-white transition hover:bg-red-500 disabled:opacity-50"
                    >
                      <IoStop /> Stop
                    </button>
                    <TermSpinner />
                    <span className="text-sm text-slate-400">
                      {phase === "closing" ? "closing out & refunding…" : "printing…"}
                    </span>
                  </>
                ) : (
                  <button
                    onClick={handlePrint}
                    disabled={printsLeft <= 0 && !(balance && balance > 0)}
                    className="flex items-center gap-2 rounded-xl bg-primary-yellow px-6 py-3 font-bold text-black transition hover:bg-primary-orange disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <IoPlay /> {stats.submitted > 0 ? "Resume printing" : "Start printing"}
                  </button>
                )}
                <div className="ml-auto flex gap-1">
                  <button
                    onClick={handleBackup}
                    title="Download the printer key"
                    className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-slate-400 transition hover:bg-white/5 hover:text-white"
                  >
                    <IoDownload /> Backup key
                  </button>
                  <button
                    onClick={handleDiscard}
                    disabled={busy}
                    title="Forget this printer"
                    className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-slate-400 transition hover:bg-white/5 hover:text-red-400 disabled:opacity-40"
                  >
                    <IoTrash /> Discard
                  </button>
                </div>
              </div>
              {error && (
                <p className="break-words rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2 font-mono text-xs text-red-300">
                  {error}
                </p>
              )}
            </section>
          )}

          {phase === "done" && (
            <section className="mt-4 flex w-full flex-col items-center gap-3 rounded-2xl border border-primary-orange/30 bg-primary-orange/[0.05] p-6 text-center">
              <span className="wt-label">( out of paper )</span>
              <p className="text-lg font-bold">
                {totalPrinted === null
                  ? "Counting what landed on-chain…"
                  : `${totalPrinted.toLocaleString()} post-quantum transactions printed.`}
              </p>
              {refunded !== null && (
                <p className="text-sm text-slate-400">
                  Refunded {microAlgosToAlgos(refunded)} ALGO to{" "}
                  <span className="font-mono">{short(session.refundTo, 8)}</span>.
                </p>
              )}
              <button
                onClick={handleDiscard}
                className="mt-2 rounded-xl bg-primary-yellow px-6 py-3 font-bold text-black transition hover:bg-primary-orange"
              >
                Install a new printer
              </button>
            </section>
          )}

          {/* Stats */}
          {stats.submitted > 0 && (
            <section className="mt-4 grid w-full grid-cols-2 gap-2 sm:grid-cols-3">
              {statTiles.map((t) => (
                <div key={t.label} className="rounded-xl border border-white/[0.07] bg-banner-grey/50 p-3">
                  <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500">
                    {t.label}
                  </span>
                  <span className="text-lg font-bold tabular-nums">{t.value}</span>
                </div>
              ))}
            </section>
          )}

          {/* Receipt tape */}
          {receipts.length > 0 && (
            <section className="mt-4 w-full overflow-hidden rounded-2xl border border-white/[0.07] bg-[#f4f1e8] text-neutral-800 shadow-inner">
              <div className="flex items-center justify-between border-b border-dashed border-neutral-400 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                <span>receipt tape · newest first</span>
                <span>{stats.submitted.toLocaleString()} this run</span>
              </div>
              <ol className="max-h-[28rem] overflow-y-auto font-mono text-xs">
                {receipts.map((r) => (
                  <li
                    key={r.txID}
                    className="animate-fade-in flex items-center gap-3 border-b border-dotted border-neutral-300 px-4 py-1.5"
                  >
                    <span className="w-14 shrink-0 text-neutral-400">#{String(r.seq).padStart(4, "0")}</span>
                    <a
                      href={getExplorerTxUrl(r.txID, session.network)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 flex-1 truncate hover:underline"
                    >
                      {r.close ? "CLOSE " : "0A PQ "}
                      {short(r.txID, 10)}
                    </a>
                    <span className="hidden shrink-0 text-neutral-500 sm:inline">sig {r.sigBytes}B</span>
                    <span
                      className={`w-24 shrink-0 text-right ${
                        r.status === "confirmed"
                          ? "text-emerald-700"
                          : r.status === "failed"
                            ? "text-red-600"
                            : "text-neutral-400"
                      }`}
                    >
                      {r.status === "confirmed" ? `✓ r${r.round}` : r.status === "failed" ? "✗ failed" : "…"}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}

      <div className="mt-10 w-full space-y-1 border-t border-white/[0.06] pt-4 text-xs text-slate-600">
        <p>
          Native PQ accounts landed in{" "}
          <a
            href="https://algorand.co/blog/getting-ahead-of-the-elliptic-curve-whats-in-the-next-consensus-upgrade"
            target="_blank"
            rel="noopener noreferrer"
            className="underline transition hover:text-primary-yellow"
          >
            Algorand 5.0
          </a>
          . The printer key lives in this browser's storage until the account is closed out; back it up
          before clearing site data.
        </p>
      </div>
    </div>
  );
}
