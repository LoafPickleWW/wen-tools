import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface ChainRow {
  id: string;
  name: string;
  scheme: string;
  since: string;
  pqTxs: number | null;
  status?: "live" | "fixed" | "partial" | "untracked";
  note?: string;
  source?: string;
  cursor?: number;
  cursorLabel?: string;
}

interface LeaderboardData {
  updatedAt: number;
  chains: ChainRow[];
}

/** Confirmed printer txns grouped by round, so ones the server hasn't scanned yet count live. */
export interface LiveBatch {
  round: number;
  count: number;
}

const POLL_MS = 30_000;
/** After a forced refresh, check again once the server's next scan window has passed. */
const FOLLOW_UP_MS = 35_000;

function fmt(n: number) {
  return Math.round(n).toLocaleString();
}

export function PQLeaderboard({
  liveBatches = [],
  feePerTx,
  refreshKey = 0,
}: {
  liveBatches?: LiveBatch[];
  /** Printer cost per PQ txn in microAlgos, to price the gap in ALGO. */
  feePerTx: number;
  /** Bump to force a fresh fetch, e.g. when a printer run completes */
  refreshKey?: number;
}) {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);

  /** `fresh` adds a query string so the CDN's 30s cache can't serve a stale copy. */
  const load = useCallback((fresh = false) => {
    fetch(fresh ? `/api/pq-leaderboard?fresh=${Date.now()}` : "/api/pq-leaderboard")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: LeaderboardData) => {
        if (!alive.current) return;
        setData(d);
        setFailed(false);
      })
      .catch(() => alive.current && setFailed(true));
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    const t = setInterval(() => load(), POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [load]);

  // Printer run finished: refresh now, and once more after the server's next scan.
  useEffect(() => {
    if (!refreshKey) return;
    load(true);
    const t = setTimeout(() => load(true), FOLLOW_UP_MS);
    return () => clearTimeout(t);
  }, [refreshKey, load]);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.chains
      .map((c) => {
        const live =
          c.id === "algorand"
            ? liveBatches.filter((b) => b.round > (c.cursor ?? Infinity)).reduce((n, b) => n + b.count, 0)
            : 0;
        return { ...c, live, total: (c.pqTxs ?? -1) + live };
      })
      .sort((a, b) => b.total - a.total);
  }, [data, liveBatches]);

  if (!data) {
    return failed ? null : (
      <div className="h-40 w-full animate-pulse rounded-2xl border border-white/[0.07] bg-banner-grey/40" />
    );
  }

  const leader = rows[0];
  const algo = rows.find((r) => r.id === "algorand");
  const algoRank = rows.findIndex((r) => r.id === "algorand") + 1;
  const gap = leader && algo ? leader.total - algo.total : 0;

  return (
    <section className="w-full overflow-hidden rounded-2xl border border-white/[0.07] bg-banner-grey/50 backdrop-blur">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
        <span className="wt-label">( pq transaction leaderboard )</span>
        <span className="font-mono text-[10px] text-slate-600">all-time · mainnet</span>
      </div>

      <ol>
        {rows.map((r, i) => {
          const pct = leader.total && r.total > 0 ? (r.total / leader.total) * 100 : 0;
          const isAlgo = r.id === "algorand";
          return (
            <li key={r.id} className="border-b border-white/[0.04] px-5 py-3 last:border-0">
              <div className="flex items-baseline gap-3">
                <span
                  className={`w-7 shrink-0 font-mono text-sm ${i === 0 ? "text-primary-yellow" : "text-slate-500"}`}
                >
                  #{i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <a
                    href={r.source}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={r.note}
                    className={`font-bold underline-offset-2 hover:underline ${isAlgo ? "text-primary-orange" : "text-white"}`}
                  >
                    {r.name}
                  </a>
                  <span className="ml-2 font-mono text-[11px] text-slate-500">
                    {r.scheme} · since {r.since.slice(0, 4)}
                    {r.status && r.status !== "live" && (
                      <span className="ml-1.5 rounded border border-white/10 px-1 text-[10px] uppercase text-slate-500">
                        {r.status === "untracked" ? "not tracked" : r.status}
                      </span>
                    )}
                  </span>
                </div>
                <span
                  className={`text-right tabular-nums ${r.pqTxs === null ? "text-sm text-slate-500" : "text-lg font-bold"}`}
                >
                  {r.pqTxs === null ? "—" : `${fmt(r.total)}${r.status === "partial" ? "+" : ""}`}
                  {r.live > 0 && (
                    <span className="ml-1.5 text-xs font-normal text-emerald-400">+{fmt(r.live)} live</span>
                  )}
                </span>
              </div>
              {r.pqTxs !== null && (
                <div className="ml-10 mt-2 h-1.5 overflow-hidden rounded-full bg-primary-black/60">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      isAlgo ? "bg-gradient-to-r from-primary-orange to-primary-yellow" : "bg-slate-500"
                    }`}
                    style={{ width: `${Math.max(pct, 0.5)}%` }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {algo && (
        <div className="border-t border-dashed border-white/[0.08] bg-primary-black/30 px-5 py-4 text-center">
          {algoRank === 1 ? (
            <p className="text-sm text-slate-300">
              Algorand is <strong className="text-primary-yellow">#1</strong>, ahead by{" "}
              <strong className="tabular-nums text-white">{fmt(rows[0].total - (rows[1]?.total ?? 0))}</strong>{" "}
              PQ transactions.
            </p>
          ) : (
            <>
              <p className="text-3xl font-bold tabular-nums text-primary-yellow">{fmt(gap + 1)}</p>
              <p className="mt-1 text-sm text-slate-400">
                PQ transactions left before Algorand is <strong className="text-white">#1</strong>
                <span className="text-slate-500">
                  {" "}
                  · ≈ {fmt(((gap + 1) * feePerTx) / 1_000_000)} ALGO of printer fuel
                </span>
              </p>
            </>
          )}
        </div>
      )}

      <p className="px-5 pb-3 pt-1 text-[11px] leading-relaxed text-slate-600">
        Counted independently from each chain's own data. Hover a chain to see how; click for the
        source. <span className="text-slate-500">Fixed</span> = a known one-off. Synced to QRL block{" "}
        {fmt(rows.find((r) => r.id === "qrl")?.cursor ?? 0)} and Algorand round {fmt(algo?.cursor ?? 0)}.
      </p>
    </section>
  );
}
