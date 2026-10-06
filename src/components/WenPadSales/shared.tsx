import type { ReactNode } from "react";
import { STATUS, STATUS_LABELS, microToAlgo } from "../../utils/wenpadSale";

export const formatAlgo = (micro: number, digits = 4) =>
  `${Number(microToAlgo(micro).toFixed(digits)).toLocaleString(undefined, { maximumFractionDigits: digits })} ALGO`;

export const shortAddr = (addr: string) => (addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "");

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-banner-grey/30 border border-white/[0.12] p-4 sm:p-6 rounded-3xl backdrop-blur-md ${className}`}>
      {children}
    </div>
  );
}

export function FieldLabel({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-1.5">
      <label className="text-[10px] font-black text-primary-orange uppercase tracking-[0.2em] ml-1">{children}</label>
      {hint && <span className="text-[11px] text-gray-500">{hint}</span>}
    </div>
  );
}

export const inputClass =
  "w-full bg-asset-detail-bg/50 border border-white/[0.08] rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary-orange/50 transition-all placeholder:text-gray-600";

export const primaryButtonClass =
  "flex items-center justify-center gap-2 px-5 py-3 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-black font-black rounded-2xl transition-all shadow-lg shadow-orange-500/20 text-sm uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer";

export const secondaryButtonClass =
  "flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl border border-white/[0.12] bg-asset-detail-bg/60 hover:bg-banner-grey text-xs font-bold text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer";

const STATUS_STYLES: Record<number, string> = {
  [STATUS.SETUP]: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  [STATUS.LIVE]: "bg-green-500/15 text-green-300 border-green-500/30",
  [STATUS.PAUSED]: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  [STATUS.RELEASED]: "bg-blue-500/15 text-blue-300 border-blue-500/30",
};

export function StatusBadge({ status, ended }: { status: number; ended?: boolean }) {
  const label = status === STATUS.LIVE && ended ? "Ended" : STATUS_LABELS[status] ?? "Unknown";
  const style = status === STATUS.LIVE && ended ? STATUS_STYLES[STATUS.RELEASED] : STATUS_STYLES[status];
  return (
    <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${style}`}>
      {label}
    </span>
  );
}

export function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className="w-full h-1.5 bg-banner-grey rounded-full overflow-hidden">
      <div className="h-full bg-primary-orange transition-all duration-700" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "error" | "success";
  children: ReactNode;
}) {
  const tones = {
    info: "bg-blue-500/10 border-blue-500/30 text-blue-200",
    warn: "bg-amber-500/10 border-amber-500/30 text-amber-200",
    error: "bg-red-500/10 border-red-500/30 text-red-200",
    success: "bg-green-500/10 border-green-500/30 text-green-200",
  };
  return <div className={`p-3.5 rounded-xl border text-xs leading-relaxed ${tones[tone]}`}>{children}</div>;
}

/** Experimental-feature disclaimer shown across Shuffle */
export function ExperimentalNotice({ compact = false }: { compact?: boolean }) {
  return (
    <Notice tone="warn">
      <strong>Experimental feature.</strong>{" "}
      {compact
        ? "Shuffle has been tested but is still experimental. Use at your own risk."
        : "Shuffle has been tested on testnet but is still experimental and has not had an independent audit. Launching a Shuffle rekeys your collection wallet to a smart contract; a bug could leave it, or the assets in it, unrecoverable. Only use a dedicated wallet that holds this collection, and never a wallet with high-value assets. Use at your own risk."}
    </Notice>
  );
}

/** Friendly "in 3d 4h" / "2h ago" for a round relative to the current round */
export function roundsToRelative(targetRound: number, currentRound: number, secondsPerRound = 2.8) {
  const seconds = Math.round((targetRound - currentRound) * secondsPerRound);
  const abs = Math.abs(seconds);
  const parts =
    abs >= 86_400
      ? `${Math.floor(abs / 86_400)}d ${Math.floor((abs % 86_400) / 3600)}h`
      : abs >= 3600
        ? `${Math.floor(abs / 3600)}h ${Math.floor((abs % 3600) / 60)}m`
        : `${Math.max(1, Math.floor(abs / 60))}m`;
  return seconds >= 0 ? `in ${parts}` : `${parts} ago`;
}
