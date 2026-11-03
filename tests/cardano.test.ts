import { describe, expect, it, vi } from "vitest";
import { bech32Decode, bech32Encode, bytesToHex, convertBits, hexToBytes } from "../src/cardano/bech32";
import { addressHexToBech32, connectCip30, discoverCip30Wallets } from "../src/cardano/cip30";
import { HIGH_FEE_SHARE, estimateSwap, executeSwap, feeSharePct, fetchSwapInfo, totalAdaOut } from "../src/cardano/nightSwap";

describe("bech32", () => {
  it("decodes and re-encodes the BIP-173 test vector", () => {
    const vector = "abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw";
    const { hrp, words } = bech32Decode(vector);
    expect(hrp).toBe("abcdef");
    expect(bech32Encode(hrp, words)).toBe(vector);
  });

  it("accepts the all-uppercase vector and rejects bad checksums and mixed case", () => {
    expect(bech32Decode("A12UEL5L").hrp).toBe("a");
    expect(() => bech32Decode("abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxx")).toThrow(/checksum/);
    expect(() => bech32Decode("Abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw")).toThrow(/Mixed/);
  });

  it("round-trips arbitrary bytes through 5-bit groups", () => {
    const bytes = Array.from({ length: 57 }, (_, i) => (i * 37 + 11) & 255);
    const words = convertBits(bytes, 8, 5, true);
    expect(convertBits(words, 5, 8, false)).toEqual(bytes);
  });
});

describe("addressHexToBech32", () => {
  const baseMainnet = "01" + "ab".repeat(56);

  it("builds an addr1 base address from CIP-30 hex and decodes back to the same bytes", () => {
    const addr = addressHexToBech32(baseMainnet);
    expect(addr.startsWith("addr1q")).toBe(true);
    const { hrp, words } = bech32Decode(addr);
    expect(hrp).toBe("addr");
    expect(bytesToHex(convertBits(words, 5, 8, false))).toBe(baseMainnet);
  });

  it("refuses testnet addresses, stake addresses and short input", () => {
    expect(() => addressHexToBech32("00" + "ab".repeat(56))).toThrow(/mainnet/);
    expect(() => addressHexToBech32("e1" + "ab".repeat(28))).toThrow(/Unsupported/);
    expect(() => addressHexToBech32("01abcd")).toThrow(/Unexpected/);
    expect(() => hexToBytes("xyz")).toThrow();
  });
});

describe("connectCip30 / discoverCip30Wallets", () => {
  const api = (network: number) => ({
    getNetworkId: async () => network,
    getUsedAddresses: async () => ["01" + "cd".repeat(56)],
    getChangeAddress: async () => "01" + "ef".repeat(56),
    signTx: vi.fn(),
    submitTx: vi.fn(),
  });

  it("returns the first used address in bech32 on mainnet", async () => {
    const { address } = await connectCip30({ key: "1am", name: "1AM", icon: "", enable: async () => api(1) });
    expect(address.startsWith("addr1")).toBe(true);
  });

  it("rejects a wallet that is not on mainnet", async () => {
    await expect(connectCip30({ key: "x", name: "X", icon: "", enable: async () => api(0) })).rejects.toThrow(/mainnet/);
  });

  it("lists 1AM first and drops alias keys with the same name", () => {
    const w = (name: string) => ({ name, icon: "", enable: async () => api(1) });
    (window as unknown as { cardano: unknown }).cardano = { eternl: w("Eternl"), app: w("1AM"), "1am": w("1AM"), notAWallet: {} };
    const wallets = discoverCip30Wallets();
    expect(wallets.map((x) => x.key)).toEqual(["1am", "eternl"]);
    delete (window as unknown as { cardano?: unknown }).cardano;
  });
});

const json = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);

describe("estimateSwap", () => {
  it("parses the live response shape: route in splits, fees, price impact, empty possible_routes", async () => {
    // Trimmed from a real /swap/estimate response (10 ADA, 1% slippage)
    const fetcher = vi.fn(() =>
      json({
        splits: [{ amount_in: 10, expected_output: 44.189023, fee: 2.69, dex: "CSWAP", price_impact: 0.0094 }],
        total_output: 44.189023,
        total_output_without_slippage: 44.635377,
        possible_routes: {},
        batcher_fee: 0.69,
        dexhunter_fee: 0,
        partner_fee: 2,
        deposits: 2,
      }),
    );
    const r = await estimateSwap({ amountAda: 10, slippage: 1 }, fetcher);
    expect(r).toEqual({
      expected: 44.635377,
      minimum: 44.189023,
      routes: [{ dex: "CSWAP", amountIn: 10 }],
      batcherFeeAda: 0.69,
      dexhunterFeeAda: 0,
      partnerFeeAda: 2,
      depositAda: 2,
      priceImpactPct: 0.0094,
    });
  });

  it("treats absent fee fields as zero rather than failing", async () => {
    const r = await estimateSwap({ amountAda: 1, slippage: 1 }, () => json({ total_output: 1, total_output_without_slippage: 1 }));
    expect([r.batcherFeeAda, r.dexhunterFeeAda, r.partnerFeeAda, r.depositAda]).toEqual([0, 0, 0, 0]);
  });

  it("takes the worst price impact across split routes and tolerates missing fee fields", async () => {
    const r = await estimateSwap(
      { amountAda: 1, slippage: 1 },
      () => json({ total_output: 1, total_output_without_slippage: 1, splits: [{ dex: "A", price_impact: 0.2 }, { dex: "B", price_impact: 1.4 }] }),
    );
    expect(r.priceImpactPct).toBe(1.4);
    expect(r.batcherFeeAda).toBe(0);
    expect(r.depositAda).toBe(0);
  });

  it("orders the two outputs rather than guessing which is the minimum", async () => {
    const fetcher = vi.fn(() =>
      json({ total_output: 98, total_output_without_slippage: "100.5", splits: [{ dex: "MINSWAPV2", amount_in: 50 }] }),
    );
    const r = await estimateSwap({ amountAda: 25, slippage: 1 }, fetcher);
    expect(r).toMatchObject({ expected: 100.5, minimum: 98, routes: [{ dex: "MINSWAPV2", amountIn: 50 }] });
    const sent = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent).toEqual({ step: "estimate", amount_in: 25, slippage: 1 });
  });

  it("surfaces the server's error message and rejects malformed quotes", async () => {
    await expect(estimateSwap({ amountAda: 1, slippage: 1 }, () => json({ error: "Swapping isn't set up" }, 503))).rejects.toThrow(/isn't set up/);
    await expect(estimateSwap({ amountAda: 1, slippage: 1 }, () => json({ total_output: "abc" }))).rejects.toThrow(/Unexpected quote/);
  });
});

describe("fee totals", () => {
  const base = { expected: 0, minimum: 0, routes: [], priceImpactPct: 0, dexhunterFeeAda: 0 };

  it("10 ADA swap (live quote): fees are 26.9% of the amount and 14.69 ADA leaves the wallet", () => {
    const e = { ...base, batcherFeeAda: 0.69, partnerFeeAda: 2, depositAda: 2 };
    expect(feeSharePct(10, e)).toBeCloseTo(26.9, 5);
    expect(totalAdaOut(10, e)).toBeCloseTo(14.69, 5);
  });

  it("1,000 ADA swap (live quote): fees are 0.7% and the deposit is not counted as a fee", () => {
    const e = { ...base, batcherFeeAda: 2, partnerFeeAda: 5, depositAda: 2 };
    expect(feeSharePct(1000, e)).toBeCloseTo(0.7, 5);
    expect(totalAdaOut(1000, e)).toBeCloseTo(1009, 5);
    expect(feeSharePct(1000, e)).toBeLessThan(HIGH_FEE_SHARE);
  });

  it("includes DexHunter's own fee when present and never divides by zero", () => {
    const e = { ...base, batcherFeeAda: 1, partnerFeeAda: 1, dexhunterFeeAda: 3, depositAda: 0 };
    expect(totalAdaOut(100, e)).toBe(105);
    expect(feeSharePct(0, e)).toBe(0);
  });
});

describe("executeSwap", () => {
  it("builds, signs partially with the wallet, merges via sign, then submits", async () => {
    const order: string[] = [];
    const fetcher = vi.fn((_: string, init?: RequestInit) => {
      const step = JSON.parse(init!.body as string).step;
      order.push(step);
      return json(step === "build" ? { cbor: "84a1" } : { cbor: "84a2ff" });
    });
    const wallet = {
      getNetworkId: async () => 1,
      getUsedAddresses: async () => [],
      getChangeAddress: async () => "",
      signTx: vi.fn(async (...a: unknown[]) => (order.push("walletSign"), a && "a100")),
      submitTx: vi.fn(async () => (order.push("walletSubmit"), "txhash123")),
    };
    const r = await executeSwap({ amountAda: 10, slippage: 1, buyerAddress: "addr1qxx", wallet }, fetcher);
    expect(r).toEqual({ txHash: "txhash123" });
    expect(order).toEqual(["build", "walletSign", "sign", "walletSubmit"]);
    expect(wallet.signTx).toHaveBeenCalledWith("84a1", true);
    expect(wallet.submitTx).toHaveBeenCalledWith("84a2ff");
  });

  it("never signs or submits when the build step fails", async () => {
    const wallet = { getNetworkId: vi.fn(), getUsedAddresses: vi.fn(), getChangeAddress: vi.fn(), signTx: vi.fn(), submitTx: vi.fn() };
    await expect(
      executeSwap({ amountAda: 10, slippage: 1, buyerAddress: "addr1qxx", wallet }, () => json({ error: "no liquidity" }, 502)),
    ).rejects.toThrow(/no liquidity/);
    expect(wallet.signTx).not.toHaveBeenCalled();
    expect(wallet.submitTx).not.toHaveBeenCalled();
  });
});

describe("fetchSwapInfo", () => {
  it("reports unconfigured on any failure", async () => {
    expect(await fetchSwapInfo(() => Promise.reject(new Error("offline")))).toEqual({ configured: false });
    expect(await fetchSwapInfo(() => json({}, 500))).toEqual({ configured: false });
    expect(await fetchSwapInfo(() => json({ configured: true, tokenId: "abc" }))).toEqual({ configured: true, tokenId: "abc" });
  });
});
