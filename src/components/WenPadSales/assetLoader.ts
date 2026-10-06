import { INDEXER_URLS, type SaleNetwork } from "../../utils/wenpadSale";

export interface CandidateAsset {
  id: number;
  name: string;
  unitName: string;
  total: number;
  decimals: number;
  amount: number;
  /** Holding is frozen in the distribution wallet, so it can never be transferred */
  holdingFrozen: boolean;
  clawback: string;
  freeze: string;
  defaultFrozen: boolean;
  url?: string;
  reserve?: string;
}

const ZERO_ADDRESS = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";

export const hasClawback = (a: CandidateAsset) => !!a.clawback && a.clawback !== ZERO_ADDRESS;
export const hasFreeze = (a: CandidateAsset) => !!a.freeze && a.freeze !== ZERO_ADDRESS;
export const isNft = (a: CandidateAsset) => a.total === 1 && a.decimals === 0;
/** Usable as a sale item: held, transferable */
export const isSellable = (a: CandidateAsset) => a.amount >= 1 && !a.holdingFrozen;

async function paginate(url: string, key: string, onPage?: (n: number) => void): Promise<any[]> {
  const out: any[] = [];
  let next = "";
  do {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}limit=1000${next ? `&next=${next}` : ""}`);
    if (!res.ok) throw new Error(`Indexer request failed (${res.status})`);
    const data = await res.json();
    out.push(...(data[key] || []));
    onPage?.(out.length);
    next = data["next-token"] || "";
  } while (next);
  return out;
}

/**
 * Every asset the distribution wallet holds, with the params needed to validate it as a sale item.
 * Params come from the wallet's created assets in bulk; assets it holds but did not create are
 * looked up individually (capped, to keep wallets full of unrelated assets fast).
 */
export async function loadDistributionAssets(
  network: SaleNetwork,
  address: string,
  onProgress?: (msg: string) => void
): Promise<CandidateAsset[]> {
  const idx = INDEXER_URLS[network];

  onProgress?.("Loading holdings…");
  const holdings = await paginate(`${idx}/v2/accounts/${address}/assets`, "assets", (n) =>
    onProgress?.(`Loading holdings… ${n}`)
  );
  const held = holdings.filter((h) => !h.deleted && Number(h.amount) > 0);

  onProgress?.("Loading asset details…");
  const created = await paginate(`${idx}/v2/accounts/${address}/created-assets`, "assets");
  const params = new Map<number, any>(created.map((a) => [Number(a.index), a.params]));

  const missing = held.map((h) => Number(h["asset-id"])).filter((id) => !params.has(id)).slice(0, 1000);
  for (let i = 0; i < missing.length; i += 8) {
    onProgress?.(`Loading asset details… ${i}/${missing.length}`);
    await Promise.all(
      missing.slice(i, i + 8).map(async (id) => {
        try {
          const res = await fetch(`${idx}/v2/assets/${id}`);
          if (res.ok) params.set(id, (await res.json()).asset?.params);
        } catch {
          // skip
        }
      })
    );
  }

  return held
    .map((h) => {
      const id = Number(h["asset-id"]);
      const p = params.get(id) || {};
      return {
        id,
        name: p.name || "",
        unitName: p["unit-name"] || "",
        total: Number(p.total ?? 0),
        decimals: Number(p.decimals ?? 0),
        amount: Number(h.amount),
        holdingFrozen: !!h["is-frozen"],
        clawback: p.clawback || "",
        freeze: p.freeze || "",
        defaultFrozen: !!p["default-frozen"],
        url: p.url || "",
        reserve: p.reserve || "",
      };
    })
    .sort((a, b) => a.id - b.id);
}

/** Parse pasted asset IDs (comma, space or newline separated), de-duplicated in order. */
export function parseAssetIds(text: string): number[] {
  const seen = new Set<number>();
  for (const part of text.split(/[\s,;]+/)) {
    const id = Number(part.trim());
    if (Number.isSafeInteger(id) && id > 0) seen.add(id);
  }
  return [...seen];
}
