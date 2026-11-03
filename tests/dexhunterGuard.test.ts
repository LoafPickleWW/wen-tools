import { describe, expect, it } from "vitest";
import { isSameOrigin, validateSwapRequest } from "../api/_lib/dexhunterGuard";

const NIGHT = "aa".repeat(28) + "4e49474854";
const ADDR = "addr1q" + "x".repeat(60);

describe("validateSwapRequest: estimate and build", () => {
  it("forces ADA in and the configured NIGHT token out, ignoring client-supplied tokens", () => {
    const r = validateSwapRequest(
      { step: "estimate", amount_in: 100, slippage: 1, token_in: "evil", token_out: "evil", blacklisted_dexes: ["X"] },
      NIGHT,
    );
    expect(r).toEqual({
      ok: true,
      path: "/swap/estimate",
      payload: { token_in: "", token_out: NIGHT, amount_in: 100, slippage: 1, blacklisted_dexes: [] },
    });
  });

  it("requires a valid mainnet address to build and never forwards extra fields", () => {
    const ok = validateSwapRequest({ step: "build", amount_in: 5, slippage: 2, buyer_address: ADDR, extra: 1 }, NIGHT);
    expect(ok).toMatchObject({ ok: true, path: "/swap/build" });
    expect((ok as { payload: Record<string, unknown> }).payload).not.toHaveProperty("extra");
    expect((ok as { payload: Record<string, unknown> }).payload.buyer_address).toBe(ADDR);

    for (const bad of ["", "addr_test1qqq", "stake1abc", ADDR.toUpperCase(), 42, null]) {
      expect(validateSwapRequest({ step: "build", amount_in: 5, slippage: 2, buyer_address: bad }, NIGHT).ok).toBe(false);
    }
  });

  it("bounds amount and slippage and rejects non-numbers", () => {
    const base = { step: "estimate", amount_in: 10, slippage: 1 };
    for (const amount_in of [0, 0.5, 50_001, NaN, Infinity, "10", null]) {
      expect(validateSwapRequest({ ...base, amount_in }, NIGHT).ok).toBe(false);
    }
    for (const slippage of [0, 0.05, 11, NaN, "1"]) {
      expect(validateSwapRequest({ ...base, slippage }, NIGHT).ok).toBe(false);
    }
    expect(validateSwapRequest({ ...base, amount_in: 1 }, NIGHT).ok).toBe(true);
    expect(validateSwapRequest({ ...base, amount_in: 50_000, slippage: 10 }, NIGHT).ok).toBe(true);
  });
});

describe("validateSwapRequest: sign", () => {
  it("accepts hex cbor and signatures and nothing else", () => {
    expect(validateSwapRequest({ step: "sign", txCbor: "84a400", signatures: "a10081" }, NIGHT)).toEqual({
      ok: true,
      path: "/swap/sign",
      payload: { txCbor: "84a400", signatures: "a10081" },
    });
    expect(validateSwapRequest({ step: "sign", txCbor: "zz", signatures: "a1" }, NIGHT).ok).toBe(false);
    expect(validateSwapRequest({ step: "sign", txCbor: "abc", signatures: "a1" }, NIGHT).ok).toBe(false); // odd length
    expect(validateSwapRequest({ step: "sign", txCbor: "aa".repeat(100_001), signatures: "a1" }, NIGHT).ok).toBe(false);
  });
});

describe("validateSwapRequest: shape", () => {
  it("rejects unknown steps and non-objects", () => {
    for (const body of [null, "x", [], { step: "refund" }, {}]) {
      expect(validateSwapRequest(body, NIGHT).ok).toBe(false);
    }
  });
});

describe("isSameOrigin", () => {
  it("allows same host and absent origin, blocks other sites", () => {
    expect(isSameOrigin("https://www.wen.tools", "www.wen.tools")).toBe(true);
    expect(isSameOrigin("http://localhost:5199", "localhost:5199")).toBe(true);
    expect(isSameOrigin(undefined, "www.wen.tools")).toBe(true);
    expect(isSameOrigin("https://evil.example", "www.wen.tools")).toBe(false);
    expect(isSameOrigin("not a url", "www.wen.tools")).toBe(false);
  });
});
