import { describe, expect, it } from "vitest";
import {
  formatUnits,
  isMidnightAddress,
  parseRecipients,
  parseUnits,
} from "../src/midnight/amounts";

const UNSHIELDED = "mn_addr_preview1" + "q".repeat(40);
const SHIELDED = "mn_shield-addr_preview1" + "q".repeat(40);

describe("parseUnits / formatUnits", () => {
  it("round-trips decimal amounts", () => {
    expect(parseUnits("1.5", 6)).toBe(1_500_000n);
    expect(parseUnits("10", 6)).toBe(10_000_000n);
    expect(formatUnits(1_500_000n, 6)).toBe("1.5");
    expect(formatUnits(10_000_000n, 6)).toBe("10");
    expect(formatUnits(1n, 6)).toBe("0.000001");
  });

  it("rejects malformed and over-precise input", () => {
    expect(() => parseUnits("1.0000001", 6)).toThrow(/decimal places/);
    expect(() => parseUnits("abc", 6)).toThrow(/valid amount/);
    expect(() => parseUnits("-1", 6)).toThrow(/valid amount/);
    expect(() => parseUnits("1.5", 0)).toThrow(/decimal places/);
  });
});

describe("isMidnightAddress", () => {
  it("matches the address type to the pool", () => {
    expect(isMidnightAddress(UNSHIELDED, "unshielded")).toBe(true);
    expect(isMidnightAddress(SHIELDED, "shielded")).toBe(true);
    expect(isMidnightAddress(UNSHIELDED, "shielded")).toBe(false);
    expect(isMidnightAddress(SHIELDED, "unshielded")).toBe(false);
    expect(isMidnightAddress("not-an-address", "unshielded")).toBe(false);
  });
});

describe("parseRecipients", () => {
  it("applies the default amount and per-line overrides", () => {
    const { recipients, errors } = parseRecipients(
      `${UNSHIELDED}\n\n${UNSHIELDED}, 2.5`,
      "unshielded",
      6,
      "1",
    );
    expect(errors).toEqual([]);
    expect(recipients.map((r) => r.value)).toEqual([1_000_000n, 2_500_000n]);
    expect(recipients.map((r) => r.line)).toEqual([1, 3]);
  });

  it("reports every bad line instead of stopping at the first", () => {
    const { recipients, errors } = parseRecipients(
      `bad\n${UNSHIELDED},0\n${UNSHIELDED},x`,
      "unshielded",
      6,
      "1",
    );
    expect(recipients).toEqual([]);
    expect(errors).toHaveLength(3);
  });

  it("requires an amount when there is no default", () => {
    const { errors } = parseRecipients(UNSHIELDED, "unshielded", 6, "");
    expect(errors[0]).toMatch(/Line 1/);
  });
});
