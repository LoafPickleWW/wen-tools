import { useEffect, useRef, useState } from "react";
import { getTopHolders, type CouponDeployment, type CouponHolder } from "../../utils/pqCoupon";
import type { PrinterNetwork } from "../../utils/pqPrinter";
import { getExplorerAddressUrl } from "../../utils/falcon";

const POLL_MS = 60_000;
/** Rows shown at first, and added per "Show more". */
const INITIAL_ROWS = 10;
const MORE_ROWS = 25;
const INDEXER_LAG_MS = 8_000;
/** Addresses per NFD reverse-lookup request. */
const NFD_BATCH = 20;

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Reverse-resolve NFD names for a batch of addresses; missing names are simply absent. */
async function lookupNfds(network: PrinterNetwork, addresses: string[]): Promise<Record<string, string>> {
  if (!addresses.length) return {};
  const base = network === "mainnet" ? "https://api.nf.domains" : "https://api.testnet.nf.domains";
  const qs = addresses.map((a) => `address=${a}`).join("&");
  try {
    const res = await fetch(`${base}/nfd/lookup?${qs}&view=tiny`);
    if (!res.ok) return {};
    const data: Record<string, { name?: string }> = await res.json();
    return Object.fromEntries(
      Object.entries(data).flatMap(([addr, nfd]) => (nfd?.name ? [[addr, nfd.name]] : [])),
    );
  } catch {
    return {};
  }
}

/** Leaderboard of PQPRINT holders: one coupon per Falcon-signed print. */
export function PQTopPrinters({
  network,
  deployment,
  highlight,
  refreshKey = 0,
}: {
  network: PrinterNetwork;
  deployment: CouponDeployment;
  /** Address to highlight, e.g. the current refund/beneficiary wallet */
  highlight?: string;
  /** Bump to refetch, e.g. after a claim lands */
  refreshKey?: number;
}) {
  const [holders, setHolders] = useState<CouponHolder[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState(INITIAL_ROWS);
  /** Addresses already sent to the NFD API (named or not), so they aren't re-queried. */
  const looked = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const all = await getTopHolders(network, deployment);
        if (alive) setHolders(all);
      } catch {
        if (alive) setHolders((h) => h ?? []);
      }
    };
    load();
    const t = setInterval(load, POLL_MS);
    // After a claim, the indexer can trail algod by a block or two: check again shortly.
    const followUp = refreshKey ? setTimeout(load, INDEXER_LAG_MS) : undefined;
    return () => {
      alive = false;
      clearInterval(t);
      clearTimeout(followUp);
    };
  }, [network, deployment.assetId, refreshKey]);

  // New network or asset: start over.
  useEffect(() => {
    looked.current.clear();
    setNames({});
    setVisible(INITIAL_ROWS);
  }, [network, deployment.assetId]);

  const myRank = holders && highlight ? holders.findIndex((h) => h.address === highlight) : -1;

  // Resolve NFD names for whatever is on screen (plus your own row), in batches.
  useEffect(() => {
    if (!holders) return;
    const shown = holders.slice(0, visible).map((h) => h.address);
    if (myRank >= visible) shown.push(holders[myRank].address);
    const todo = shown.filter((a) => !looked.current.has(a));
    if (!todo.length) return;
    todo.forEach((a) => looked.current.add(a));
    let alive = true;
    (async () => {
      for (let i = 0; i < todo.length; i += NFD_BATCH) {
        const found = await lookupNfds(network, todo.slice(i, i + NFD_BATCH));
        if (!alive) return;
        if (Object.keys(found).length) setNames((n) => ({ ...n, ...found }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [holders, visible, myRank, network]);

  const row = (h: CouponHolder, rank: number, pinned = false) => {
    const me = h.address === highlight;
    return (
      <li
        key={pinned ? `pinned-${h.address}` : h.address}
        className={`flex items-center gap-3 border-b border-white/[0.04] px-5 py-2 last:border-0 ${
          me ? "bg-primary-orange/[0.08]" : ""
        } ${pinned ? "border-t border-dashed border-t-white/[0.08]" : ""}`}
      >
        <span className={`w-12 shrink-0 ${rank === 0 ? "text-primary-yellow" : "text-slate-500"}`}>
          #{rank + 1}
        </span>
        <a
          href={getExplorerAddressUrl(h.address, network)}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 truncate text-slate-300 hover:text-primary-yellow"
        >
          {names[h.address] ?? short(h.address)}
          {me && <span className="ml-2 text-[10px] uppercase text-primary-orange">you</span>}
        </a>
        <span className="shrink-0 tabular-nums text-white">
          {h.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
          <span className="ml-1 text-[10px] text-slate-500">PQPRINT</span>
        </span>
      </li>
    );
  };

  const remaining = holders ? holders.length - visible : 0;

  return (
    <section className="w-full overflow-hidden rounded-2xl border border-white/[0.07] bg-banner-grey/50 backdrop-blur">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
        <span className="wt-label">( top printers )</span>
        <span className="font-mono text-[10px] text-slate-600">
          {holders?.length ? `${holders.length.toLocaleString()} holders · ` : ""}by PQPRINT held · {network}
        </span>
      </div>

      {holders === null ? (
        <div className="h-24 animate-pulse" />
      ) : holders.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-slate-500">
          No coupons claimed yet. Print and close out to take the #1 spot.
        </p>
      ) : (
        <>
          <ol className="font-mono text-sm">
            {holders.slice(0, visible).map((h, i) => row(h, i))}
            {/* Your row, pinned, when you rank below what's shown */}
            {myRank >= visible && row(holders[myRank], myRank, true)}
          </ol>
          {(remaining > 0 || visible > INITIAL_ROWS) && (
            <div className="flex items-center justify-center gap-4 border-t border-white/[0.06] px-5 py-2.5 text-xs">
              {remaining > 0 && (
                <button
                  onClick={() => setVisible((v) => v + MORE_ROWS)}
                  className="rounded-lg px-3 py-1.5 font-semibold text-primary-orange transition hover:bg-primary-orange/10"
                >
                  Show {Math.min(MORE_ROWS, remaining)} more
                  <span className="ml-1 font-normal text-slate-500">({remaining.toLocaleString()} left)</span>
                </button>
              )}
              {visible > INITIAL_ROWS && (
                <button
                  onClick={() => setVisible(INITIAL_ROWS)}
                  className="rounded-lg px-3 py-1.5 text-slate-400 transition hover:bg-white/5 hover:text-white"
                >
                  Show less
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
