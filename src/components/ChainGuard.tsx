import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useChain } from "../context/ChainContext";
import { useMidnight } from "../midnight/MidnightContext";
import { isFullMoon, moonIllumination, moonPhase, moonPhaseName } from "../midnight/moon";
import { MidnightSend } from "../pages/MidnightSend";
import { MidnightWallet } from "../pages/MidnightWallet";
import { Meta } from "./Meta";

/** Paths that make sense on either chain and are rendered as-is. */
const SHARED_PATHS = ["/terms", "/privacy", "/encyclopedia"];

/** Algorand send routes show the Midnight send tool instead while Midnight is active. */
const SEND_PATHS = ["/distribution-suite", "/airdrop", "/simple-send", "/simple-airdrop", "/midnight-send"];

/** "5h 12m" until the next local midnight, refreshed every 30s. */
function useUntilMidnight(): string {
  const compute = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    const mins = Math.max(0, Math.round((next.getTime() - now.getTime()) / 60_000));
    return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
  };
  const [value, setValue] = useState(compute);
  useEffect(() => {
    const id = setInterval(() => setValue(compute()), 30_000);
    return () => clearInterval(id);
  }, []);
  return value;
}

function MidnightHome() {
  const { networkId } = useMidnight();
  const phase = moonPhase();
  const lit = Math.round(moonIllumination(phase) * 100);
  const full = isFullMoon(phase);
  const untilMidnight = useUntilMidnight();

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-16 text-white">
      <Meta title="wen.tools on Midnight" noindex />
      <div className="mn-terminal text-xs uppercase tracking-[0.3em] text-brand">after dark</div>
      <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">wen.tools on Midnight</h1>
      <p className="mt-3 max-w-xl text-slate-400">
        Send and manage NIGHT on Midnight. Most tools are built for Algorand and stay hidden here; more
        will follow.
      </p>

      <div className="mn-terminal mt-8 max-w-xl rounded-2xl border border-white/10 bg-asset-detail-bg/70 p-4 text-xs leading-relaxed text-slate-300 backdrop-blur">
        <div>
          <span className="text-brand">~/midnight $</span> status --network {networkId ?? "unconnected"}
        </div>
        <div className="text-slate-400">
          &gt; moon: {moonPhaseName(phase)} · {lit}% lit
        </div>
        <div className={full ? "text-red-300" : "text-slate-400"}>
          &gt; {full ? "full moon tonight" : `next midnight in ${untilMidnight}`}
        </div>
        <div>
          <span className="text-brand">~/midnight $</span> <span className="mn-caret" />
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          to="/midnight-send"
          className="block rounded-2xl border border-white/10 bg-asset-detail-bg/80 p-5 backdrop-blur transition hover:border-brand/50"
        >
          <div className="font-semibold">Send</div>
          <div className="mt-1 text-sm text-slate-400">
            Send NIGHT and other tokens to one or many recipients by hand or CSV, shielded or unshielded.
          </div>
        </Link>
        <Link
          to="/wallet"
          className="block rounded-2xl border border-white/10 bg-asset-detail-bg/80 p-5 backdrop-blur transition hover:border-brand/50"
        >
          <div className="font-semibold">Wallet</div>
          <div className="mt-1 text-sm text-slate-400">
            Balances, DUST and addresses for your connected Midnight wallet.
          </div>
        </Link>
      </div>
    </div>
  );
}

function AlgorandOnly() {
  const { setActiveChain, algorandConnected } = useChain();
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-24 text-center text-white">
      <Meta title="Algorand only" noindex />
      <h1 className="text-2xl font-bold">This tool is Algorand only</h1>
      <p className="mt-3 text-slate-400">
        You're viewing Midnight. Switch to Algorand to use this tool.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        {algorandConnected && (
          <button className="wt-btn wt-btn-primary h-10 px-5" onClick={() => setActiveChain("algorand")}>
            Switch to Algorand
          </button>
        )}
        <Link to="/" className="wt-btn wt-btn-ghost h-10 px-5">
          Home
        </Link>
      </div>
      {!algorandConnected && (
        <p className="mt-4 text-xs text-slate-500">Connect an Algorand wallet from the header to switch.</p>
      )}
    </div>
  );
}

/**
 * Wraps the route table. On Algorand it is a pass-through; on Midnight it swaps in
 * Midnight pages and blocks the Algorand-only ones.
 */
export function ChainGuard({ children }: { children: ReactNode }) {
  const { activeChain } = useChain();
  const { pathname } = useLocation();
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

  if (path === "/midnight-send") return <MidnightSend />;
  if (activeChain === "algorand") return <>{children}</>;
  if (SEND_PATHS.includes(path)) return <MidnightSend />;
  if (path === "/wallet") return <MidnightWallet />;
  if (path === "/") return <MidnightHome />;
  if (SHARED_PATHS.includes(path)) return <>{children}</>;
  return <AlgorandOnly />;
}
