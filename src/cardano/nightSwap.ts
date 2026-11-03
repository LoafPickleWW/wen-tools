import type { Cip30Api } from "./cip30";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface SwapInfo {
  configured: boolean;
  /** Asset id the swap buys, shown so people can check it against Midnight's docs */
  tokenId?: string;
}

export interface SwapRoute {
  dex: string;
  amountIn: number;
}

export interface SwapEstimate {
  /** DexHunter returns the amount with and without slippage; ordering the two avoids guessing which is which */
  expected: number;
  minimum: number;
  routes: SwapRoute[];
  /** ADA the DEX's batcher takes for executing the order, on top of the amount paid */
  batcherFeeAda: number;
  /** ADA held with the order; Cardano DEX orders carry a minimum-ADA deposit */
  depositAda: number;
  /** Worst price impact across the routes, in percent */
  priceImpactPct: number;
}

export const DEFAULT_SLIPPAGE = 1;
export const SLIPPAGE_OPTIONS = [0.5, 1, 2, 5];
/** Above this the UI warns that the swap may fill at a noticeably worse price. */
export const HIGH_SLIPPAGE = 2;
/** Price impact in percent above which the UI warns. */
export const HIGH_PRICE_IMPACT = 1;

async function callProxy(step: string, body: Record<string, unknown>, fetcher: Fetcher): Promise<unknown> {
  const res = await fetcher("/api/dexhunter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string })?.error || `Swap service error (${res.status})`);
  }
  return data;
}

export async function fetchSwapInfo(fetcher: Fetcher = fetch): Promise<SwapInfo> {
  try {
    const res = await fetcher("/api/dexhunter");
    if (!res.ok) return { configured: false };
    const data = (await res.json()) as SwapInfo;
    return { configured: !!data.configured, tokenId: data.tokenId };
  } catch {
    return { configured: false };
  }
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  if (typeof n !== "number" || !Number.isFinite(n)) throw new Error("Unexpected quote from the swap service");
  return n;
};

export async function estimateSwap(
  args: { amountAda: number; slippage: number },
  fetcher: Fetcher = fetch,
): Promise<SwapEstimate> {
  const data = (await callProxy("estimate", { amount_in: args.amountAda, slippage: args.slippage }, fetcher)) as Record<string, unknown>;
  const a = num(data.total_output);
  const b = num(data.total_output_without_slippage);
  // Live responses carry the route in `splits`; `possible_routes` has come back as an empty object
  const splits = Array.isArray(data.splits) ? (data.splits as Record<string, unknown>[]) : [];
  const routes = splits.map((r) => ({ dex: String(r.dex ?? "unknown"), amountIn: Number(r.amount_in) || 0 }));
  const optional = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    expected: Math.max(a, b),
    minimum: Math.min(a, b),
    routes,
    batcherFeeAda: optional(data.batcher_fee),
    depositAda: optional(data.deposits),
    priceImpactPct: Math.max(0, ...splits.map((r) => optional(r.price_impact))),
  };
}

/**
 * build -> wallet signs (partial) -> sign -> wallet submits. DexHunter builds and merges the
 * transaction; the wallet only signs and submits, and shows the user the transaction first.
 */
export async function executeSwap(
  args: { amountAda: number; slippage: number; buyerAddress: string; wallet: Cip30Api },
  fetcher: Fetcher = fetch,
): Promise<{ txHash: string }> {
  const { amountAda, slippage, buyerAddress, wallet } = args;
  const built = (await callProxy(
    "build",
    { amount_in: amountAda, slippage, buyer_address: buyerAddress },
    fetcher,
  )) as { cbor?: string };
  if (typeof built.cbor !== "string") throw new Error("The swap service didn't return a transaction");

  const signatures = await wallet.signTx(built.cbor, true);
  const signed = (await callProxy("sign", { txCbor: built.cbor, signatures }, fetcher)) as { cbor?: string };
  if (typeof signed.cbor !== "string") throw new Error("The swap service didn't return a signed transaction");

  const txHash = await wallet.submitTx(signed.cbor);
  return { txHash };
}
