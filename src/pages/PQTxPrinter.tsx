import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@txnlab/use-wallet-react";
import algosdk from "algosdk";
import QRCode from "qrcode";
import { toast } from "react-toastify";
import { IoCopy, IoDownload, IoPlay, IoPrint, IoStop, IoTrash } from "react-icons/io5";
import { Callout, TermSpinner, ToolHero } from "../components/cypher/ToolKit";
import { Meta } from "../components/Meta";
import { PQLeaderboard, type LiveBatch } from "../components/quantum/PQLeaderboard";
import { PQTopPrinters } from "../components/quantum/PQTopPrinters";
import { PQCouponSource } from "../components/quantum/PQCouponSource";
import { PQ_COUPON, getPendingCoupons, isOptedIn } from "../utils/pqCoupon";
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
/** Tape feed tick; each tick prints one line, or a few when the queue backs up. */
const FEED_INTERVAL_MS = 45;
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
  /** Mainnet confirmations, fed to the leaderboard before its next server sync. */
  const [liveBatches, setLiveBatches] = useState<LiveBatch[]>([]);
  const [refunded, setRefunded] = useState<number | null>(null);
  /** PQPRINT earned by this printer and not yet claimed; null = not registered. */
  const [coupons, setCoupons] = useState<number | null>(null);
  /** Whether the refund wallet can receive PQPRINT; null = unknown / not applicable. */
  const [optedIn, setOptedIn] = useState<boolean | null>(null);
  const [couponsPaid, setCouponsPaid] = useState<number | null>(null);
  const [holdersKey, setHoldersKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  /**
   * Paper feed: submitted receipts queue here and are fed onto the tape at a
   * steady pace, so it scrolls like a printer instead of jumping 16 at a time.
   * Status updates for receipts still in the queue wait in `feedStatus`.
   */
  const feedQueue = useRef<Receipt[]>([]);
  const feedStatus = useRef(new Map<string, Partial<Receipt>>());
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

  // ── Coupons: registration status and beneficiary opt-in ───────────────────
  const couponDeployment = session?.coupons ? PQ_COUPON[session.network] : null;

  useEffect(() => {
    if (!session || !couponDeployment || session.closed) return setCoupons(null);
    getPendingCoupons(getPrinterAlgod(session.network), couponDeployment, session.account.address)
      .then(setCoupons)
      .catch(() => {}); // node hiccup: keep the last known state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.account.address, couponDeployment?.appId]);

  const checkOptIn = useCallback(async () => {
    const s = sessionRef.current;
    const dep = s?.coupons ? PQ_COUPON[s.network] : null;
    if (!s || !dep || !algosdk.isValidAddress(refundTo)) return setOptedIn(null);
    setOptedIn(await isOptedIn(getPrinterAlgod(s.network), dep, refundTo));
  }, [refundTo]);

  useEffect(() => {
    checkOptIn();
  }, [checkOptIn, session?.coupons]);

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

  // Feed the tape: drain faster when the queue is long, but always one line at a time feel.
  useEffect(() => {
    const t = setInterval(() => {
      const queue = feedQueue.current;
      if (!queue.length) return;
      const batch = queue.splice(0, Math.max(1, Math.ceil(queue.length / 12)));
      const lines = batch.map((r) => ({ ...r, ...feedStatus.current.get(r.txID) }));
      for (const r of batch) feedStatus.current.delete(r.txID);
      setReceipts((rs) => [...lines.reverse(), ...rs].slice(0, TAPE_LENGTH));
    }, FEED_INTERVAL_MS);
    return () => clearInterval(t);
  }, []);

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
        coupons: PQ_COUPON[walletNetwork] !== null,
      };
      sessionRef.current = next;
      saveSession(next);
      setSession(next);
      setBalance(0);
      setRefundTo(activeAddress ?? "");
      setReceipts([]);
      feedQueue.current = [];
      feedStatus.current.clear();
      setStats(EMPTY_STATS);
      setRefunded(null);
      setCouponsPaid(null);
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
      const group = [txn];
      // Coupons go to the funding wallet by default: bundle its PQPRINT opt-in so it's one signature.
      const beneficiary = refundTo || activeAddress;
      if (couponDeployment && beneficiary === activeAddress && optedIn !== true) {
        const wantsOptIn = !(await isOptedIn(algod, couponDeployment, activeAddress));
        if (wantsOptIn) {
          group.push(
            algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
              from: activeAddress,
              to: activeAddress,
              amount: 0,
              assetIndex: couponDeployment.assetId,
              suggestedParams: sp,
            }),
          );
          algosdk.assignGroupID(group);
        }
      }
      const signed = await signTransactions(group.map((t) => algosdk.encodeUnsignedTransaction(t)));
      if (signed.some((s) => !s)) throw new Error("Signing cancelled");
      await algod.sendRawTransaction(signed as Uint8Array[]).do();
      await algosdk.waitForConfirmation(algod, txn.txID().toString(), 10);
      toast.success(`Loaded ${fundAmount} ALGO into the printer`);
      if (!refundTo) setRefundTo(activeAddress);
      await Promise.all([refreshBalance(), checkOptIn()]);
    } catch (err: any) {
      toast.error(err?.message ?? String(err));
    } finally {
      setFunding(false);
    }
  };

  const handleOptIn = async () => {
    if (!session || !couponDeployment || !activeAddress) return;
    setFunding(true);
    try {
      const algod = getPrinterAlgod(session.network);
      const sp = await algod.getTransactionParams().do();
      const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        from: activeAddress,
        to: activeAddress,
        amount: 0,
        assetIndex: couponDeployment.assetId,
        suggestedParams: sp,
      });
      const [signed] = await signTransactions([algosdk.encodeUnsignedTransaction(txn)]);
      if (!signed) throw new Error("Signing cancelled");
      await algod.sendRawTransaction(signed).do();
      await algosdk.waitForConfirmation(algod, txn.txID().toString(), 10);
      toast.success("Opted in to PQPRINT");
      await checkOptIn();
    } catch (err: any) {
      toast.error(err?.message ?? String(err));
    } finally {
      setFunding(false);
    }
  };

  const handlePrint = async () => {
    const s = sessionRef.current;
    if (!s) return;
    if (couponDeployment && coupons === null && optedIn !== true) {
      toast.error("Opt the refund wallet in to PQPRINT first, or turn coupons off.");
      return;
    }
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
      // Receipts still waiting in the feed pick the update up when they're printed.
      for (const r of feedQueue.current) if (set.has(r.txID)) feedStatus.current.set(r.txID, patch);
      setReceipts((rs) => rs.map((r) => (set.has(r.txID) ? { ...r, ...patch } : r)));
    };

    try {
      const result = await runPrinter(sessionRef.current!, controller.signal, {
        onSubmitted: (batch) => {
          if (batch.some((r) => r.kind === "close")) setPhase("closing");
          feedQueue.current.push(...batch);
          setStats((st) => ({
            ...st,
            submitted: st.submitted + batch.length,
            sigBytes: st.sigBytes + batch.reduce((n, r) => n + r.sigBytes, 0),
          }));
        },
        onConfirmed: (ids, round) => {
          markReceipts(ids, { status: "confirmed", round });
          setStats((st) => ({ ...st, confirmed: st.confirmed + ids.length, lastRound: round }));
          if (sessionRef.current?.network === "mainnet") {
            setLiveBatches((bs) => [...bs, { round, count: ids.length }]);
          }
        },
        onFailed: (ids, msg) => {
          markReceipts(ids, { status: "failed" });
          setStats((st) => ({ ...st, failed: st.failed + ids.length }));
          setError(msg);
        },
        onBalance: setBalance,
        onSeq: (nextSeq) => updateSession({ nextSeq }),
        onCoupons: setCoupons,
      });

      if (result.closed) {
        updateSession({ closed: true });
        setRefunded(result.refunded ?? 0);
        setCouponsPaid(result.coupons ?? null);
        setCoupons(null);
        setHoldersKey((k) => k + 1);
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
    feedQueue.current = [];
    feedStatus.current.clear();
    setStats(EMPTY_STATS);
    setRefunded(null);
    setCouponsPaid(null);
    setCoupons(null);
    setError(null);
    setPhase("idle");
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const fee = nativePQFee(MIN_FEE);
  const couponMode = couponDeployment ? { registered: coupons !== null } : undefined;
  const printsLeft = balance === null ? 0 : estimatePrints(balance, minBalance, MIN_FEE, couponMode);
  const fundPreview = estimatePrints(
    algosToMicroAlgos(fundAmount) || 0,
    100_000,
    MIN_FEE,
    couponDeployment ? { registered: false } : undefined,
  );
  /** The coupon board follows the header's network switch, like the rest of the site. */
  const boardNetwork = walletNetwork;
  const boardDeployment = PQ_COUPON[boardNetwork];
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
      coupons !== null
        ? { label: "PQPRINT earned", value: coupons.toLocaleString() }
        : { label: "last round", value: stats.lastRound?.toLocaleString() ?? "–" },
    ],
    [stats, fee, tps, coupons],
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

      <div className="mb-6 w-full">
        <PQLeaderboard liveBatches={liveBatches} feePerTx={fee} />
      </div>

      <Callout label="how it works">
        Your browser generates a <strong className="text-white">Falcon-1024</strong> keypair and derives a
        native post-quantum Algorand address from it. No LogicSig and no padding transactions: since
        Algorand 5.0 the ledger verifies a lattice-based signature on every transaction directly. Each
        print is a 0-ALGO transaction costing{" "}
        <strong className="text-primary-yellow">{microAlgosToAlgos(fee).replace(/0+$/, "")} ALGO</strong>{" "}
        (min fee + PQ surcharge). When the balance can't cover another one, the printer closes the
        account and refunds the 0.1 ALGO minimum balance.
        {boardDeployment && (
          <>
            {" "}
            With coupons on, each print is a call to the open-source PQCoupon contract and earns{" "}
            <strong className="text-white">1 PQPRINT</strong>, paid to your wallet when the printer
            closes out.
          </>
        )}
      </Callout>

      <div className="mt-3 w-full">
        <Callout tone="warn" label="before you start">
          <ul className="list-disc space-y-1 pl-4">
            <li>
              <strong>This browser is the printer.</strong> It holds the printer's key and signs every
              transaction. Your wallet only signs the one payment that loads it, and no server or
              contract is involved.
            </li>
            <li>
              <strong>Keep this tab open while printing.</strong> Closing it or letting the device sleep
              pauses the printer. Come back to this page in the same browser to resume.
            </li>
            <li>
              <strong>Only this browser can spend the printer's balance.</strong> Clearing site data or
              switching devices strands whatever is left, so use <em>Backup key</em> if you load more
              than you'd be happy to lose.
            </li>
          </ul>
        </Callout>
      </div>

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
                <span className="wt-label">
                  {couponDeployment
                    ? "( refund leftover ALGO + send PQPRINT to )"
                    : "( refund leftover min balance to )"}
                </span>
                <input
                  value={refundTo}
                  onChange={(e) => setRefundTo(e.target.value.trim())}
                  // Registration binds the coupon beneficiary on-chain, so it can't change after.
                  disabled={busy || coupons !== null}
                  placeholder="Algorand address"
                  className="rounded-xl border border-white/10 bg-primary-black/40 px-3 py-2.5 font-mono text-xs outline-none focus:border-primary-orange/50 disabled:opacity-60"
                />
              </label>

              {PQ_COUPON[session.network] ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-white/[0.06] bg-primary-black/30 px-3 py-2.5 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!session.coupons}
                      disabled={busy || coupons !== null}
                      onChange={(e) => updateSession({ coupons: e.target.checked })}
                      className="accent-[rgb(var(--brand))]"
                    />
                    <span>
                      Earn <strong className="text-primary-yellow">PQPRINT</strong>: 1 coupon per print
                    </span>
                  </label>
                  {couponDeployment &&
                    (coupons !== null ? (
                      <span className="font-mono text-xs text-emerald-400">registered · {coupons} earned</span>
                    ) : optedIn === true ? (
                      <span className="font-mono text-xs text-emerald-400">✓ wallet opted in</span>
                    ) : optedIn === false ? (
                      activeAddress === refundTo && !networkMismatch ? (
                        <button
                          onClick={handleOptIn}
                          disabled={funding}
                          className="rounded-lg border border-primary-orange/40 px-3 py-1 text-xs font-semibold text-primary-orange transition hover:bg-primary-orange/10 disabled:opacity-40"
                        >
                          Opt in to PQPRINT
                        </button>
                      ) : (
                        <span className="text-xs text-amber-300">
                          The refund wallet must opt in to PQPRINT ({couponDeployment.assetId}) first
                        </span>
                      )
                    ) : null)}
                  <span className="text-[11px] text-slate-500">
                    Setup costs 2 PQ txns + a 0.0317 ALGO deposit, refunded at close-out.
                  </span>
                </div>
              ) : (
                <p className="text-xs text-slate-500">PQPRINT coupons aren't live on {session.network} yet.</p>
              )}
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
                      {phase === "closing"
                        ? "closing out & refunding…"
                        : "printing… keep this tab open"}
                    </span>
                  </>
                ) : (
                  <button
                    onClick={handlePrint}
                    disabled={
                      (printsLeft <= 0 && !(balance && balance > 0)) ||
                      (!!couponDeployment && coupons === null && optedIn !== true)
                    }
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
              {couponsPaid !== null && (
                <p className="text-sm text-slate-300">
                  <strong className="text-primary-yellow">{couponsPaid.toLocaleString()} PQPRINT</strong>{" "}
                  claimed to your wallet.
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
                      {r.kind === "close" ? "CLOSE " : r.kind === "register" ? "SETUP " : "0A PQ "}
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

      {boardDeployment && (
        <div className="mt-8 flex w-full flex-col gap-4">
          <PQTopPrinters
            network={boardNetwork}
            deployment={boardDeployment}
            highlight={refundTo || activeAddress || undefined}
            refreshKey={holdersKey}
          />
          <PQCouponSource network={boardNetwork} deployment={boardDeployment} />
        </div>
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
