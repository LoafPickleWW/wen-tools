import * as algosdk from "algosdk";
import { describe, expect, it } from "vitest";
import {
  buildAddItemsGroup,
  buildArc59Claim,
  buildCommit,
  buildCreateSale,
  buildDeleteItemPages,
  buildRegister,
  buildReveal,
  buildSaleAction,
  findRevealForCommit,
  getAlgod,
  getCollectEstimate,
  getCommit,
  getCurrentRound,
  getFactoryStats,
  getPayouts,
  getSaleByApp,
  getSaleState,
  holdsAsset,
  listCommits,
  listSales,
  packPayouts,
  parseCommitResult,
  parseCreateSaleResult,
  parseRevealedAsset,
  planCollect,
  planQueueUpTo,
  waitForRound,
} from "../src/utils/wenpadSaleCore";
import { boxKey } from "./fakeChain";
import { ALICE, BOB, CAROL, sk } from "./accounts";
import { wire, plain } from "./wire";
import { sha512_256 } from "@noble/hashes/sha2.js";

const FACTORY = 1001;
const SALE = 2001;
const u64 = (n: number) => algosdk.encodeUint64(n);
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const pre = (s: string, ...rest: Uint8Array[]) => cat(new TextEncoder().encode(s), ...rest);
const pk = (a: string) => algosdk.decodeAddress(a).publicKey;

const RECORD = algosdk.ABIType.from("(uint64,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64)");
const META = algosdk.ABIType.from("(string,string,string,string)");
const COMMIT = algosdk.ABIType.from("(address,uint64,uint64,uint64,uint64,uint64)");
const REVEALED = algosdk.ABIType.from("(uint64,address,uint64,uint64)");
const REVEALED_SEL = sha512_256(new TextEncoder().encode("Revealed(uint64,address,uint64,uint64)")).slice(0, 4);

function seedSale(status = 1) {
  chain.addApp({
    id: FACTORY,
    creator: ALICE,
    globalState: { total_sales: 3, total_volume: 12_000_000 },
    boxes: {
      [boxKey(pre("s", u64(7)))]: RECORD.encode([SALE, ALICE, BOB, CAROL, 1_000_000, 100, 9_000, 300, 12, status, 50, 12_000_000]),
      [boxKey(pre("m", u64(7)))]: META.encode(["Wen Shuffle", "WSHF", "arc3", "ipfs://bafycollection"]),
      [boxKey(pre("s", u64(6)))]: RECORD.encode([2000, ALICE, BOB, CAROL, 5, 1, 2, 3, 4, 3, 5, 6]),
      [boxKey(pre("m", u64(6)))]: META.encode(["Old", "OLD", "arc69", ""]),
      [boxKey(pre("x", u64(1)))]: new Uint8Array([1]),
    },
  });
  chain.addApp({
    id: SALE,
    creator: algosdk.getApplicationAddress(FACTORY).toString(),
    globalState: {
      sale_id: 7,
      factory: FACTORY,
      admin: pk(ALICE),
      distribution: pk(BOB),
      price: 1_000_000,
      start: 100,
      end: 9_000,
      reveal_fee: 20_000,
      delivery_budget: 400_000,
      status,
      total: 300,
      remaining: 288,
      pending: 2,
      sold: 12,
      proceeds: 12_000_000,
      next_commit: 15,
      next_reveal: 13,
    },
    boxes: {
      p: cat(pk(CAROL), u64(7_000), u64(0), pk(ALICE), u64(3_000), u64(5)),
      [boxKey(pre("c", u64(13)))]: COMMIT.encode([CAROL, chain.round - 2_000, 1_000_000, 20_000, 400_000, 31_700]),
      [boxKey(pre("c", u64(14)))]: COMMIT.encode([BOB, chain.round - 5, 1_000_000, 20_000, 400_000, 31_700]),
      [boxKey(pre("i", u64(0)))]: new Uint8Array(8),
      [boxKey(pre("i", u64(1)))]: new Uint8Array(8),
    },
  });
}

/** Simulate hook: app calls get one inner txn and touch the sale's commit box. */
function simulateWithInners() {
  chain.simulateHook = (group) => ({
    txns: group.map((s) => ({ inner: s.txn.type === "appl" ? 1 : 0 })),
    unnamed: { accounts: [CAROL], apps: [FACTORY], assets: [77], boxes: [{ app: SALE, name: pre("c", u64(14)) }] },
  });
}

describe("wenpadSaleCore reads", () => {
  it("listSales, getFactoryStats, getSaleByApp", async () => {
    seedSale();
    const sales = await listSales("mainnet", FACTORY);
    expect(sales.map((s) => s.saleId)).toEqual([7, 6]);
    expect(plain(sales)).toMatchSnapshot();
    expect(await getFactoryStats("mainnet", FACTORY)).toEqual({ totalSales: 3, totalVolume: 12_000_000 });
    const byApp = await getSaleByApp("mainnet", FACTORY, SALE);
    expect(byApp?.metadata.name).toBe("Wen Shuffle");
    expect(await getSaleByApp("mainnet", 999, SALE)).toBeNull();
  });

  it("getSaleState decodes globals with number types", async () => {
    seedSale();
    const state = await getSaleState("mainnet", SALE);
    expect(plain(state)).toMatchSnapshot();
    expect(typeof state.price).toBe("number");
    expect(state.admin).toBe(ALICE);
  });

  it("payouts and commits", async () => {
    seedSale();
    expect(await getPayouts("mainnet", SALE)).toEqual([
      { address: CAROL, bps: 7_000 },
      { address: ALICE, bps: 3_000 },
    ]);
    expect(plain(await getCommit("mainnet", SALE, 13))).toMatchSnapshot();
    expect(await getCommit("mainnet", SALE, 99)).toBeNull();
    expect((await listCommits("mainnet", SALE)).map((c) => c.commitId).sort()).toEqual([13, 14]);
    expect((await listCommits("mainnet", SALE, BOB)).map((c) => c.commitId)).toEqual([14]);
  });

  it("planQueueUpTo cancels expired commits and reveals the rest", async () => {
    seedSale();
    expect(await planQueueUpTo("mainnet", SALE, 14)).toEqual([
      { commitId: 13, targetRound: chain.round - 2_000, action: "cancel" },
      { commitId: 14, targetRound: chain.round - 5, action: "reveal" },
    ]);
  });

  it("rounds and holdings", async () => {
    chain.addAccount({ address: BOB, assets: [{ id: 77, amount: 1 }, { id: 78, amount: 0 }] });
    expect(await getCurrentRound("mainnet")).toBe(chain.round);
    expect(await holdsAsset("mainnet", BOB, 77)).toBe(true);
    expect(await holdsAsset("mainnet", BOB, 78)).toBe(false);
    expect(await holdsAsset("mainnet", BOB, 79)).toBe(false);
    const start = chain.round;
    expect(await waitForRound(getAlgod("mainnet"), start + 1)).toBe(start + 2);
  });

  it("getCollectEstimate", async () => {
    seedSale(3);
    chain.addAccount({ address: algosdk.getApplicationAddress(SALE).toString(), amount: 15_000_000 });
    const [sale] = await listSales("mainnet", FACTORY);
    expect(await getCollectEstimate("mainnet", sale)).toMatchSnapshot();
  });

  it("findRevealForCommit reads indexer logs", async () => {
    const log = cat(REVEALED_SEL, REVEALED.encode([14, BOB, 555, 1234]));
    const b64 = btoa(String.fromCharCode(...log));
    chain.on("GET", /idx\.algonode\.cloud\/v2\/transactions/, () => ({ transactions: [{ logs: [b64] }], "current-round": 1 }));
    expect(await findRevealForCommit("mainnet", SALE, 14, 1)).toEqual({ commitId: 14, buyer: BOB, assetId: 555, inboxCost: 1234 });
    expect(await findRevealForCommit("mainnet", SALE, 15, 1)).toBeNull();
  });
});

describe("wenpadSaleCore parsing", () => {
  it("parses ABI returns and inner app ids from real confirmations", async () => {
    // Go through submit + waitForConfirmation so the parser sees whatever shape the SDK returns.
    const ret = cat(new Uint8Array([0x15, 0x1f, 0x7c, 0x75]), u64(7));
    chain.confirmHook = () => ({
      logs: [ret],
      "inner-txns": [{ "pool-error": "", txn: { txn: { type: "appl", snd: pk(ALICE), fv: 1, lv: 2 } }, "application-index": SALE }],
    });
    chain.simulateHook = (group) => ({ txns: group.map(() => ({})) });
    const [optIn] = await buildSaleAction("mainnet", ALICE, SALE, "pause");
    const signed = algosdk.signTransaction(optIn, sk("alice")).blob;
    await getAlgod("mainnet").sendRawTransaction(signed).do();
    const confirmation = await algosdk.waitForConfirmation(getAlgod("mainnet"), optIn.txID().toString(), 3);
    expect(parseCreateSaleResult(confirmation)).toEqual({ saleId: 7, appId: SALE });
    expect(parseCommitResult(confirmation)).toEqual({ commitId: 7, targetRound: chain.round + 1 });
    expect(parseRevealedAsset([new Uint8Array([1, 2]), cat(REVEALED_SEL, REVEALED.encode([1, CAROL, 2, 3]))])).toEqual({
      commitId: 1,
      buyer: CAROL,
      assetId: 2,
      inboxCost: 3,
    });
  });

  it("packPayouts validates and packs", () => {
    expect(packPayouts([{ address: BOB, bps: 10_000 }])).toEqual(cat(pk(BOB), u64(10_000)));
    expect(() => packPayouts([{ address: BOB, bps: 9_000 }])).toThrow(/100%/);
  });
});

describe("wenpadSaleCore builders (simulate + resource population)", () => {
  it("buildCreateSale", async () => {
    simulateWithInners();
    const txns = await buildCreateSale("mainnet", FACTORY, BOB, {
      admin: ALICE,
      payouts: [{ address: CAROL, bps: 10_000 }],
      price: 1_000_000,
      startRound: 100,
      endRound: 9_000,
      revealFee: 20_000,
      deliveryBudget: 400_000,
      metadata: { name: "Wen Shuffle", unitName: "WSHF", standard: "arc3", metadataUrl: "ipfs://x" },
    });
    expect(txns).toHaveLength(2);
    expect(txns.map(wire)).toMatchSnapshot();
  });

  it("buildAddItemsGroup splits into [pay, addItems] pairs", async () => {
    simulateWithInners();
    const ids = Array.from({ length: 300 }, (_, i) => 10_000 + i);
    const txns = await buildAddItemsGroup("mainnet", BOB, SALE, ids, 120);
    expect(txns.map((t) => wire(t).type)).toEqual(["pay", "appl", "pay", "appl"]);
    expect(txns.map(wire)).toMatchSnapshot();
  });

  it("buildRegister adds opUps after a budget failure", async () => {
    let calls = 0;
    chain.simulateHook = (group) => {
      calls++;
      if (calls === 1) return { failure: "logic eval error: dynamic cost budget exceeded" };
      return { txns: group.map(() => ({ inner: 0 })) };
    };
    const txns = await buildRegister("mainnet", BOB, SALE);
    expect(txns.map((t) => wire(t).type)).toEqual(["appl", "appl", "pay"]);
    expect(txns.map(wire)).toMatchSnapshot();
  });

  it("buildCommit, buildReveal, buildSaleAction", async () => {
    seedSale();
    simulateWithInners();
    const state = await getSaleState("mainnet", SALE);
    const commit = await buildCommit("mainnet", CAROL, state);
    const reveal = await buildReveal("mainnet", CAROL, SALE, 14);
    const pause = await buildSaleAction("mainnet", ALICE, SALE, "pause");
    expect(wire(reveal[0]).lv).toBe(`int:${chain.round + 10}`);
    expect({ commit: commit.map(wire), reveal: reveal.map(wire), pause: pause.map(wire) }).toMatchSnapshot();
  });

  it("buildArc59Claim opts in only when needed", async () => {
    simulateWithInners();
    chain.addAccount({ address: CAROL, assets: [{ id: 77, amount: 0 }] });
    const opted = await buildArc59Claim("mainnet", CAROL, 77);
    const notOpted = await buildArc59Claim("mainnet", CAROL, 78);
    expect(opted).toHaveLength(1);
    expect(notOpted).toHaveLength(2);
    expect({ opted: opted.map(wire), notOpted: notOpted.map(wire) }).toMatchSnapshot();
  });

  it("buildDeleteItemPages and planCollect", async () => {
    seedSale(1);
    simulateWithInners();
    const pages = await buildDeleteItemPages("mainnet", ALICE, SALE);
    const steps = await planCollect("mainnet", FACTORY, ALICE, { appId: SALE, saleId: 7 });
    expect(steps).toHaveLength(1);
    const collect = await steps[0]();
    expect(collect.map((t) => wire(t).type)).toEqual(["appl", "appl", "appl", "appl"]);
    expect({ pages: pages.map((g) => g.map(wire)), collect: collect.map(wire) }).toMatchSnapshot();
  });

  it("surfaces contract rejections with a readable message", async () => {
    chain.simulateHook = () => ({ failure: "transaction rejected by logic: assert failed pc=99" });
    await expect(buildSaleAction("mainnet", ALICE, SALE, "release")).rejects.toThrow(/contract rejected|assert failed/);
  });
});
