import { useEffect, useState } from "react";
import { getTopHolders, type CouponDeployment, type CouponHolder } from "../../utils/pqCoupon";
import type { PrinterNetwork } from "../../utils/pqPrinter";
import { getExplorerAddressUrl } from "../../utils/falcon";

const POLL_MS = 60_000;
const TOP_N = 10;

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

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const top = await getTopHolders(network, deployment, TOP_N);
        if (!alive) return;
        setHolders(top);
        const nfds = await lookupNfds(network, top.map((h) => h.address));
        if (alive) setNames(nfds);
      } catch {
        if (alive) setHolders((h) => h ?? []);
      }
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [network, deployment.assetId, refreshKey]);

  return (
    <section className="w-full overflow-hidden rounded-2xl border border-white/[0.07] bg-banner-grey/50 backdrop-blur">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
        <span className="wt-label">( top printers )</span>
        <span className="font-mono text-[10px] text-slate-600">by PQPRINT held · {network}</span>
      </div>

      {holders === null ? (
        <div className="h-24 animate-pulse" />
      ) : holders.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-slate-500">
          No coupons claimed yet. Print and close out to take the #1 spot.
        </p>
      ) : (
        <ol className="font-mono text-sm">
          {holders.map((h, i) => {
            const me = h.address === highlight;
            return (
              <li
                key={h.address}
                className={`flex items-center gap-3 border-b border-white/[0.04] px-5 py-2 last:border-0 ${
                  me ? "bg-primary-orange/[0.08]" : ""
                }`}
              >
                <span className={`w-8 shrink-0 ${i === 0 ? "text-primary-yellow" : "text-slate-500"}`}>
                  #{i + 1}
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
          })}
        </ol>
      )}
    </section>
  );
}
