import { useEffect, useMemo, useState } from "react";

interface ChainRow {
  id: string;
  name: string;
  scheme: string;
  since: string;
  pqTxs: number;
  cursor: number;
  cursorLabel: string;
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

function fmt(n: number) {
  return Math.round(n).toLocaleString();
}

export function PQLeaderboard({
  liveBatches = [],
  feePerTx,
}: {
  liveBatches?: LiveBatch[];
  /** Printer cost per PQ txn in microAlgos, to price the gap in ALGO. */
  feePerTx: number;
}) {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/pq-leaderboard")
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((d: LeaderboardData) => {
          if (!alive) return;
          setData(d);
          setFailed(false);
        })
        .catch(() => alive && setFailed(true));
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.chains
      .map((c) => {
        const live =
          c.id === "algorand"
            ? liveBatches.filter((b) => b.round > c.cursor).reduce((n, b) => n + b.count, 0)
            : 0;
        return { ...c, live, total: c.pqTxs + live };
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
          const pct = leader.total ? (r.total / leader.total) * 100 : 0;
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
                  <span className={`font-bold ${isAlgo ? "text-primary-orange" : "text-white"}`}>{r.name}</span>
                  <span className="ml-2 font-mono text-[11px] text-slate-500">
                    {r.scheme} · since {r.since.slice(0, 4)}
                  </span>
                </div>
                <span className="text-right text-lg font-bold tabular-nums">
                  {fmt(r.total)}
                  {r.live > 0 && (
                    <span className="ml-1.5 text-xs font-normal text-emerald-400">+{fmt(r.live)} live</span>
                  )}
                </span>
              </div>
              <div className="ml-10 mt-2 h-1.5 overflow-hidden rounded-full bg-primary-black/60">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    isAlgo ? "bg-gradient-to-r from-primary-orange to-primary-yellow" : "bg-slate-500"
                  }`}
                  style={{ width: `${Math.max(pct, 0.5)}%` }}
                />
              </div>
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
        QRL counts every transaction except the one coinbase per block (all others are XMSS-signed).
        Algorand counts native Falcon-1024 <code className="text-slate-500">pqsig</code> transactions
        since Algorand 5.0. Synced to QRL block {fmt(rows.find((r) => r.id === "qrl")?.cursor ?? 0)} and
        Algorand round {fmt(algo?.cursor ?? 0)}.
      </p>
    </section>
  );
}
