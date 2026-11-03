import { describe, expect, it } from "vitest";
import { csvToRecipientText } from "../src/midnight/csv";
import { formatDust } from "../src/midnight/amounts";

describe("csvToRecipientText", () => {
  it("reads a headed CSV regardless of column order", () => {
    const r = csvToRecipientText("amount,receiver\n10,mn_addr_a\n2.5,mn_addr_b\n");
    expect(r.text).toBe("mn_addr_a, 10\nmn_addr_b, 2.5");
    expect(r.rows).toBe(2);
  });

  it("treats a headerless CSV as address,amount", () => {
    const r = csvToRecipientText("mn_addr_a,10\nmn_addr_b\n");
    expect(r.text).toBe("mn_addr_a, 10\nmn_addr_b");
  });

  it("leaves the amount off when the cell is empty so the default applies", () => {
    const r = csvToRecipientText("receiver,amount\nmn_addr_a,\n");
    expect(r.text).toBe("mn_addr_a");
  });

  it("reports an empty file", () => {
    expect(csvToRecipientText("\n\n").error).toBeTruthy();
  });
});

describe("formatDust", () => {
  it("shows DUST from SPECK (10^15) trimmed to 4 decimals", () => {
    expect(formatDust(5n * 10n ** 15n)).toBe("5");
    expect(formatDust(1_234_567_890_123_456n)).toBe("1.2345");
    expect(formatDust(0n)).toBe("0");
  });
});
