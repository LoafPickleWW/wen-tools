import { useEffect, useState } from "react";
import { useChainPulse, type PulseBlock } from "../../context/ChainPulse";

const blockUrl = (network: string, round: number) =>
  `https://lora.algokit.io/${network}/block/${round}`;

const shortHash = (h?: string) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : "········…····");

function avgBlockTime(blocks: PulseBlock[]) {
  if (blocks.length < 3) return null;
  const span = blocks[0].at - blocks[blocks.length - 1].at;
  const rounds = blocks[0].round - blocks[blocks.length - 1].round;
  return rounds > 0 ? span / rounds / 1000 : null;
}

/** Re-renders every second so "age" labels stay current. */
function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * A live view of the chain tip: real rounds and block hashes streaming in
 * from the public node, each linking out to an explorer to verify.
 */
export function LedgerStrip() {
  const { blocks, live, network } = useChainPulse();
  const now = useNow();
  const avg = avgBlockTime(blocks);
  const visible = blocks.slice(0, 6);

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-primary-black/60 text-left font-mono backdrop-blur">
      {/* Status bar */}
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-2.5 text-[11px] uppercase tracking-[0.12em] text-slate-500">
        <span className="flex items-center gap-2">
          <span
            className={`h-1.5 w-1.5 rounded-full ${live ? "wt-pulse-dot bg-emerald-400" : "bg-slate-600"}`}
          />
          <span className={live ? "text-emerald-400" : ""}>{live ? "live" : "syncing"}</span>
        </span>
        <span className="text-slate-600">/</span>
        <span>algorand:{network}</span>
        <span className="ml-auto hidden sm:inline">
          {avg ? `${avg.toFixed(2)}s / block` : "measuring…"}
        </span>
      </div>

      {/* Blocks */}
      <div
        className="relative flex gap-2 overflow-hidden p-3"
        style={{
          maskImage: "linear-gradient(90deg, #000 70%, transparent)",
          WebkitMaskImage: "linear-gradient(90deg, #000 70%, transparent)",
        }}
      >
        {visible.length === 0 &&
          Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-[74px] w-44 shrink-0 animate-pulse rounded-xl border border-white/[0.05] bg-white/[0.02]"
            />
          ))}
        {visible.map((b, i) => (
          <a
            key={b.round}
            href={blockUrl(network, b.round)}
            target="_blank"
            rel="noreferrer"
            title={`Verify round ${b.round} on Lora`}
            className={`group relative w-44 shrink-0 rounded-xl border px-3 py-2.5 transition duration-300 hover:border-primary-orange/50 ${
              i === 0
                ? "wt-block-in border-primary-orange/40 bg-primary-orange/[0.07]"
                : "border-white/[0.07] bg-white/[0.02]"
            }`}
          >
            {/* chain link to the previous (older) block */}
            {i < visible.length - 1 && (
              <span className="absolute -right-2 top-1/2 h-px w-2 bg-gradient-to-r from-primary-orange/50 to-white/10" />
            )}
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span>{i === 0 ? "▸ latest" : "block"}</span>
              <span>{Math.max(0, Math.round((now - b.at) / 1000))}s</span>
            </div>
            <div
              className={`mt-1 text-sm font-medium tabular-nums ${
                i === 0 ? "text-primary-orange" : "text-slate-200"
              }`}
            >
              #{b.round.toLocaleString("en-US")}
            </div>
            <div className="mt-0.5 truncate text-[10px] text-slate-500 group-hover:text-slate-300">
              {shortHash(b.hash)}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

/** Compact live round counter, shown in the sub-page breadcrumb bar. */
export function BlockTicker() {
  const { blocks, live, network } = useChainPulse();
  const tip = blocks[0];
  if (!tip) return null;
  return (
    <a
      href={blockUrl(network, tip.round)}
      target="_blank"
      rel="noreferrer"
      title="Latest Algorand round. Click to verify."
      className="flex items-center gap-2 rounded-lg py-1 font-mono text-[11px] tabular-nums text-slate-500 transition hover:text-slate-200"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-400" : "bg-slate-600"}`} />
      <span key={tip.round} className="wt-tick-in">
        #{tip.round.toLocaleString("en-US")}
      </span>
    </a>
  );
}
