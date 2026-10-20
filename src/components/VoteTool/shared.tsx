import { useEffect, useState } from "react";
import { getAlgod, type VoteNetwork } from "../../utils/voteTool";

export { Panel, FieldLabel, Notice, inputClass, primaryButtonClass, secondaryButtonClass, shortAddr, roundsToRelative } from "../WenPadSales/shared";

/** Option colours for the pie chart and legend (same order everywhere). */
export const OPTION_COLORS = [
  "#f97316", "#38bdf8", "#a3e635", "#f472b6", "#facc15", "#818cf8", "#34d399", "#fb7185",
  "#c084fc", "#2dd4bf", "#fbbf24", "#60a5fa", "#4ade80", "#e879f9", "#f87171", "#94a3b8",
];

export interface AssetInfo {
  id: number;
  name: string;
  unitName: string;
  decimals: number;
}

const assetCache = new Map<string, Promise<AssetInfo | null>>();

export function fetchAssetInfo(network: VoteNetwork, id: number): Promise<AssetInfo | null> {
  const key = `${network}:${id}`;
  if (!assetCache.has(key)) {
    assetCache.set(
      key,
      getAlgod(network)
        .getAssetByID(id)
        .do()
        .then((a) => ({
          id,
          name: a.params?.name ?? `Asset ${id}`,
          unitName: a.params?.unitName ?? "",
          decimals: Number(a.params?.decimals ?? 0),
        }))
        .catch(() => null)
    );
  }
  return assetCache.get(key)!;
}

export function useAssetInfo(network: VoteNetwork, id: number) {
  const [info, setInfo] = useState<AssetInfo | null>(null);
  useEffect(() => {
    if (!id) return setInfo(null);
    let live = true;
    fetchAssetInfo(network, id).then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, [network, id]);
  return info;
}

/** Base units → display string with the asset's decimals. */
export function formatUnits(amount: bigint, decimals: number) {
  if (decimals === 0) return amount.toLocaleString();
  const s = amount.toString().padStart(decimals + 1, "0");
  const whole = BigInt(s.slice(0, -decimals)).toLocaleString();
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/** Display string → base units. Returns null when it isn't a valid amount. */
export function parseUnits(value: string, decimals: number): bigint | null {
  const v = value.trim();
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  const [whole, frac = ""] = v.split(".");
  if (frac.length > decimals) return null;
  return BigInt(whole + frac.padEnd(decimals, "0"));
}

/** Batch NFD reverse lookup (address → name.algo). Missing names are simply absent. */
export async function lookupNfds(network: VoteNetwork, addresses: string[]): Promise<Record<string, string>> {
  const base = network === "testnet" ? "https://api.testnet.nf.domains" : "https://api.nf.domains";
  const out: Record<string, string> = {};
  const unique = [...new Set(addresses)];
  for (let i = 0; i < unique.length; i += 20) {
    const qs = unique.slice(i, i + 20).map((a) => `address=${a}`).join("&");
    try {
      const res = await fetch(`${base}/nfd/lookup?${qs}&view=tiny&allowUnverified=false`);
      if (!res.ok) continue;
      const data = await res.json();
      for (const [addr, nfd] of Object.entries<any>(data)) if (nfd?.name) out[addr] = nfd.name;
    } catch {
      // NFD names are a nicety; addresses still show.
    }
  }
  return out;
}

/** Resolve an NFD name (foo.algo) to its deposit address. */
export async function resolveNfd(network: VoteNetwork, name: string): Promise<string | null> {
  const base = network === "testnet" ? "https://api.testnet.nf.domains" : "https://api.nf.domains";
  try {
    const res = await fetch(`${base}/nfd/${encodeURIComponent(name.toLowerCase())}?view=tiny`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.depositAccount ?? null;
  } catch {
    return null;
  }
}

export function PieChart({ values, size = 180 }: { values: { label: string; value: number }[]; size?: number }) {
  const total = values.reduce((n, v) => n + v.value, 0);
  const r = size / 2 - 6;
  const c = size / 2;
  if (total === 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="No votes yet">
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={24} />
        <text x={c} y={c + 4} textAnchor="middle" className="fill-gray-500 text-xs font-bold">
          No votes yet
        </text>
      </svg>
    );
  }
  let angle = -Math.PI / 2;
  const arcs = values.map((v, i) => {
    const sweep = (v.value / total) * Math.PI * 2;
    const start = angle;
    angle += sweep;
    if (v.value === 0) return null;
    if (sweep >= Math.PI * 2 - 1e-9) {
      return <circle key={i} cx={c} cy={c} r={r} fill="none" stroke={OPTION_COLORS[i]} strokeWidth={24} />;
    }
    const x1 = c + r * Math.cos(start);
    const y1 = c + r * Math.sin(start);
    const x2 = c + r * Math.cos(angle);
    const y2 = c + r * Math.sin(angle);
    return (
      <path
        key={i}
        d={`M ${x1} ${y1} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2} ${y2}`}
        fill="none"
        stroke={OPTION_COLORS[i]}
        strokeWidth={24}
      >
        <title>{`${v.label}: ${((v.value / total) * 100).toFixed(1)}%`}</title>
      </path>
    );
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Vote results">
      {arcs}
    </svg>
  );
}
