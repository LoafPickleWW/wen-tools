import { describe, expect, it } from "vitest";
import { TOOLS } from "../src/constants";
import { searchTools } from "../src/utils/toolSearch";

const top = (q: string, n = 3) => searchTools(TOOLS, q).slice(0, n).map((t) => t.label);

describe("searchTools", () => {
  it("handles phrases with filler words", () => {
    expect(top("mint an nft")).toEqual(expect.arrayContaining(["Simple Mint"]));
    expect(top("mint an ARC-19 collection")).toContain("Batch Collection Mint");
    expect(top("airdrop to 5,000 holders")).toContain("Distribution Suite");
  });

  it("matches plurals, verb forms and partial words", () => {
    expect(top("airdrops")).toContain("Distribution Suite");
    expect(top("minting nfts").length).toBeGreaterThan(0);
    expect(top("vani")).toContain("Vanity Address");
  });

  it("uses synonyms", () => {
    expect(top("burn tokens")).toContain("Batch Destroy");
    expect(top("trade nfts")).toContain("Wen Swap");
    expect(top("host a website")).toContain("Wen Deploy");
  });

  it("ranks exact label matches first", () => {
    expect(top("jukebox", 1)).toEqual(["Jukebox"]);
    expect(top("wen wallet", 1)).toEqual(["Wen Wallet"]);
  });

  it("returns nothing for gibberish", () => {
    expect(searchTools(TOOLS, "zzqxv")).toEqual([]);
  });
});
