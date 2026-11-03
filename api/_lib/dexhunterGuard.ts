/**
 * Request validation for the DexHunter proxy. The proxy spends our partner key, so it only
 * forwards one narrow shape: buy the configured NIGHT token with ADA on mainnet. Everything
 * is rebuilt from known fields; nothing the client sends is passed through as-is.
 */

export const MIN_ADA = 1;
export const MAX_ADA = 50_000;
export const MIN_SLIPPAGE = 0.1;
export const MAX_SLIPPAGE = 10;

const MAINNET_ADDRESS = /^addr1[0-9a-z]{50,120}$/;
const HEX = /^(?:[0-9a-fA-F]{2})+$/;
const MAX_CBOR_HEX = 200_000;
const MAX_SIGNATURES_HEX = 40_000;

export type SwapStep = "estimate" | "build" | "sign";

export type GuardResult =
  | { ok: true; path: string; payload: Record<string, unknown> }
  | { ok: false; error: string };

const PATHS: Record<SwapStep, string> = {
  estimate: "/swap/estimate",
  build: "/swap/build",
  sign: "/swap/sign",
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function validateSwapRequest(body: unknown, nightTokenId: string): GuardResult {
  if (!isRecord(body)) return { ok: false, error: "Invalid request body" };
  const step = body.step;
  if (step !== "estimate" && step !== "build" && step !== "sign") {
    return { ok: false, error: "Unknown step" };
  }

  if (step === "sign") {
    const { txCbor, signatures } = body;
    if (typeof txCbor !== "string" || !HEX.test(txCbor) || txCbor.length > MAX_CBOR_HEX) {
      return { ok: false, error: "Invalid transaction" };
    }
    if (typeof signatures !== "string" || !HEX.test(signatures) || signatures.length > MAX_SIGNATURES_HEX) {
      return { ok: false, error: "Invalid signatures" };
    }
    return { ok: true, path: PATHS.sign, payload: { txCbor, signatures } };
  }

  const amount = body.amount_in;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < MIN_ADA || amount > MAX_ADA) {
    return { ok: false, error: `Amount must be between ${MIN_ADA} and ${MAX_ADA} ADA` };
  }
  const slippage = body.slippage;
  if (
    typeof slippage !== "number" ||
    !Number.isFinite(slippage) ||
    slippage < MIN_SLIPPAGE ||
    slippage > MAX_SLIPPAGE
  ) {
    return { ok: false, error: `Slippage must be between ${MIN_SLIPPAGE}% and ${MAX_SLIPPAGE}%` };
  }

  // token_in "" is ADA. token_out is always the configured NIGHT token, set here, not by the client.
  const payload: Record<string, unknown> = {
    token_in: "",
    token_out: nightTokenId,
    amount_in: amount,
    slippage,
    blacklisted_dexes: [],
  };

  if (step === "build") {
    const buyer = body.buyer_address;
    if (typeof buyer !== "string" || !MAINNET_ADDRESS.test(buyer)) {
      return { ok: false, error: "Invalid Cardano mainnet address" };
    }
    payload.buyer_address = buyer;
  }
  return { ok: true, path: PATHS[step], payload };
}

/** Only same-site browser requests may use the proxy; a missing Origin (curl, server-side) is allowed. */
export function isSameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
