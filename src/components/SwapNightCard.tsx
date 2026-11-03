import { useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { Cip30Api, Cip30Wallet, connectCip30, discoverCip30Wallets } from "../cardano/cip30";
import {
  DEFAULT_SLIPPAGE,
  HIGH_PRICE_IMPACT,
  HIGH_SLIPPAGE,
  SLIPPAGE_OPTIONS,
  SwapEstimate,
  SwapInfo,
  estimateSwap,
  executeSwap,
  fetchSwapInfo,
} from "../cardano/nightSwap";

/** Mirrors the server's bounds in api/_lib/dexhunterGuard.ts. */
const MIN_ADA = 1;
const MAX_ADA = 50_000;

const DEXHUNTER_APP_URL = "https://app.dexhunter.io";

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 6 });
const shortId = (id: string) => (id.length > 24 ? `${id.slice(0, 10)}…${id.slice(-10)}` : id);

type Phase = "idle" | "building" | "signing" | "done";

/**
 * Buys NIGHT with ADA on Cardano through DexHunter's swap API (via our /api/dexhunter proxy).
 * DexHunter builds the transaction; the user's Cardano wallet signs and submits it.
 */
export function SwapNightCard() {
  const [info, setInfo] = useState<SwapInfo | null>(null);
  const [wallets, setWallets] = useState<Cip30Wallet[]>([]);
  const [connected, setConnected] = useState<{ api: Cip30Api; address: string; name: string } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE);
  const [quote, setQuote] = useState<SwapEstimate | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const quoteSeq = useRef(0);

  useEffect(() => {
    fetchSwapInfo().then(setInfo);
  }, []);

  // Wallet extensions inject after load, so poll briefly like the Midnight side does
  useEffect(() => {
    const scan = () => setWallets(discoverCip30Wallets());
    scan();
    const timer = setInterval(scan, 600);
    const stop = setTimeout(() => clearInterval(timer), 4000);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, []);

  const ada = Number(amount);
  const validAmount = amount.trim() !== "" && Number.isFinite(ada) && ada >= MIN_ADA && ada <= MAX_ADA;

  // Debounced live quote; a sequence number drops answers that arrive out of order
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (!info?.configured || !validAmount) return;
    const seq = ++quoteSeq.current;
    const timer = setTimeout(() => {
      estimateSwap({ amountAda: ada, slippage })
        .then((q) => seq === quoteSeq.current && setQuote(q))
        .catch((e: Error) => seq === quoteSeq.current && setQuoteError(e.message));
    }, 500);
    return () => clearTimeout(timer);
  }, [info?.configured, validAmount, ada, slippage]);

  async function connect(wallet: Cip30Wallet) {
    setConnecting(true);
    try {
      const { api, address } = await connectCip30(wallet);
      setConnected({ api, address, name: wallet.name });
    } catch (e) {
      toast.error((e as Error)?.message || "Couldn't connect to that wallet");
    } finally {
      setConnecting(false);
    }
  }

  async function swap() {
    if (!connected || !validAmount || !quote) return;
    setPhase("building");
    try {
      const { txHash: hash } = await executeSwap({
        amountAda: ada,
        slippage,
        buyerAddress: connected.address,
        wallet: connected.api,
      });
      setTxHash(hash);
      setPhase("done");
      toast.success("Swap submitted!");
    } catch (e) {
      setPhase("idle");
      toast.error((e as Error)?.message || "Swap failed");
    }
  }

  const fallback = (
    <a className="wt-btn wt-btn-ghost h-9 px-4 text-xs" href={DEXHUNTER_APP_URL} target="_blank" rel="noreferrer">
      Open DexHunter
    </a>
  );

  if (!info) return <p className="mt-2 text-slate-500">Checking swap availability…</p>;

  if (!info.configured) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className="text-slate-500">Swapping isn't set up on this site yet.</span>
        {fallback}
      </div>
    );
  }

  const busy = phase === "building" || phase === "signing";

  return (
    <div className="mt-2 space-y-3">
      {info.tokenId && (
        <p className="text-[11px] text-slate-500">
          Buys asset <span className="font-mono text-slate-400" title={info.tokenId}>{shortId(info.tokenId)}</span>.
          Check it against Midnight's docs or a block explorer.
        </p>
      )}

      {!connected ? (
        <div className="flex flex-wrap items-center gap-2">
          {wallets.length === 0 ? (
            <span className="text-slate-500">No Cardano wallet detected. 1AM and Lace work.</span>
          ) : (
            wallets.map((w) => (
              <button
                key={w.key}
                disabled={connecting}
                className="wt-btn wt-btn-ghost h-9 gap-2 px-4 text-xs"
                onClick={() => connect(w)}
              >
                {w.icon && <img src={w.icon} alt="" className="h-4 w-4" />}
                Connect {w.name}
              </button>
            ))
          )}
          {fallback}
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">
          {connected.name} · <span className="font-mono">{shortId(connected.address)}</span>
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-400">
          Pay (ADA)
          <input
            className="rounded-xl border border-white/10 bg-primary-black/50 px-3 py-2 text-sm text-white focus:border-brand/60 focus:outline-none"
            inputMode="decimal"
            placeholder={`${MIN_ADA} to ${MAX_ADA.toLocaleString()}`}
            value={amount}
            disabled={busy}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <div className="flex flex-col gap-1 text-[11px] font-semibold text-slate-400">
          Slippage
          <div className="flex gap-1.5">
            {SLIPPAGE_OPTIONS.map((s) => (
              <button
                key={s}
                disabled={busy}
                onClick={() => setSlippage(s)}
                className={`flex-1 rounded-lg border px-2 py-2 text-xs transition ${
                  slippage === s ? "border-brand/60 text-white" : "border-white/10 text-slate-400 hover:text-white"
                }`}
              >
                {s}%
              </button>
            ))}
          </div>
        </div>
      </div>

      {amount.trim() !== "" && !validAmount && (
        <p className="text-red-400">Enter between {MIN_ADA} and {MAX_ADA.toLocaleString()} ADA.</p>
      )}
      {slippage > HIGH_SLIPPAGE && (
        <p className="text-amber-400">High slippage: the swap may fill at a noticeably worse price.</p>
      )}
      {quoteError && <p className="text-red-400">{quoteError}</p>}

      {quote && (
        <div className="rounded-xl border border-white/10 bg-primary-black/40 p-3 text-slate-300">
          <div>
            You receive about <b className="text-white">{fmt(quote.expected)} NIGHT</b>
          </div>
          <div className="text-slate-500">
            Minimum at {slippage}% slippage: {fmt(quote.minimum)} NIGHT
            {quote.routes.length > 0 && <> · via {quote.routes.map((r) => r.dex).join(", ")}</>}
          </div>
          <div className="mt-2 border-t border-white/[0.07] pt-2 text-slate-500">
            On top of the {fmt(ada)} ADA: <b className="text-slate-300">{fmt(quote.batcherFeeAda)} ADA</b> batcher
            fee and a <b className="text-slate-300">{fmt(quote.depositAda)} ADA</b> order deposit. Price impact{" "}
            {fmt(quote.priceImpactPct)}%.
          </div>
        </div>
      )}
      {quote && quote.priceImpactPct > HIGH_PRICE_IMPACT && (
        <p className="text-amber-400">
          High price impact: this swap moves the pool price by {fmt(quote.priceImpactPct)}%. Try a smaller amount.
        </p>
      )}

      <button
        className="wt-btn wt-btn-primary h-10 px-5 text-sm"
        disabled={!connected || !quote || busy}
        onClick={swap}
      >
        {busy ? "Waiting for your wallet…" : "Swap ADA for NIGHT"}
      </button>
      <p className="text-[11px] text-slate-500">
        Your wallet shows the full transaction before you approve it. Nothing is sent until you do.
      </p>

      {phase === "done" && txHash && (
        <p className="text-emerald-400">
          Submitted.{" "}
          <a
            className="underline"
            href={`https://cardanoscan.io/transaction/${txHash}`}
            target="_blank"
            rel="noreferrer"
          >
            View transaction
          </a>
          . Next, step 2.
        </p>
      )}
    </div>
  );
}
