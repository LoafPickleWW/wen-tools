/**
 * Vote Tool client core (src/utils/voteCore.ts), offline against the fake chain.
 *
 * These cover decoding, group building and the settlement plan: the "can everyone get their
 * tokens and deposits back" accounting. The contract itself is exercised on testnet by
 * contracts/test/vote-tool.testnet.ts, which checks real balances before and after.
 */
import * as algosdk from "algosdk";
import * as fs from "fs";
import { describe, expect, it } from "vitest";
import { sha512_256 } from "@noble/hashes/sha2.js";
import {
  BALLOT_MBR,
  MAX_CALLS_PER_GROUP,
  MODE,
  NFT_MBR,
  NO_WINNER,
  REGISTRY_ENTRY_MBR,
  RETURN,
  STATUS,
  boxMbr,
  buildCreateVote,
  buildRelease,
  buildVoteEscrow,
  buildVoteHeld,
  buildVoteNft,
  decodeRegistryEntry,
  estimateCreateVoteFunding,
  isCollectionPiece,
  getVoteState,
  listBallots,
  listNftVotes,
  listRegistry,
  parseCreateVoteResult,
  planSettlement,
  validateCreateVote,
  verifyVote,
  type BallotInfo,
  type NftVote,
  type VoteState,
} from "../src/utils/voteCore";
import { APP_DEPOSITS, KNOWN_VOTE_TEMPLATES } from "../src/utils/voteTemplates";
import { FakeResponse, boxKey } from "./fakeChain";
import { findStale, keepVote } from "../src/utils/voteKeeper";
import { ALICE, BOB, CAROL, sk } from "./accounts";

const FACTORY = 3001;
const REGISTRY = 3002;
const VOTE = 3003;
const ASSET = 77;
const u64 = (n: number | bigint) => algosdk.encodeUint64(n);
const pk = (a: string) => algosdk.decodeAddress(a).publicKey;
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
const META = algosdk.ABIType.from("(string,string)");
const OPTION = algosdk.ABIType.from("(string,string,address)");
const BALLOT = algosdk.ABIType.from("(uint64,uint64,uint64)");
const VOTE_PROGRAM = new Uint8Array(fs.readFileSync("contracts/build/vote/Vote.approval.bin"));

const registryRecord = (appId: number, status = STATUS.ACTIVE, winner: bigint = NO_WINNER, weight = 0, voters = 0) =>
  cat(u64(appId), pk(ALICE), u64(MODE.ESCROW), u64(ASSET), u64(100), u64(200), u64(status), u64(winner), u64(weight), u64(voters));

function tallyBox(...weights: number[]) {
  const t = new Uint8Array(16 * 8);
  weights.forEach((w, i) => t.set(u64(w), i * 8));
  return t;
}

function seedVote(overrides: Record<string, number | Uint8Array> = {}) {
  chain.addApp({
    id: FACTORY,
    creator: ALICE,
    globalState: { admin: pk(ALICE), registry: REGISTRY, total_votes: 2, total_lists: 0, grace: 200_000 },
  });
  chain.addApp({
    id: REGISTRY,
    creator: algosdk.getApplicationAddress(FACTORY).toString(),
    globalState: { factory: FACTORY },
    boxes: {
      [boxKey(pre("v", u64(1)))]: registryRecord(999, STATUS.CLOSED, 1n, 40, 3),
      [boxKey(pre("v", u64(2)))]: registryRecord(VOTE, STATUS.ACTIVE, NO_WINNER, 7, 2),
    },
  });
  chain.addApp({
    id: VOTE,
    creator: algosdk.getApplicationAddress(FACTORY).toString(),
    approval: VOTE_PROGRAM,
    globalState: {
      factory: FACTORY,
      registry: REGISTRY,
      vote_no: 2,
      creator: pk(ALICE),
      mode: MODE.ESCROW,
      asset: ASSET,
      apv: 1_000,
      start: 100,
      end: 200,
      return_mode: RETURN.SENDERS,
      return_addr: new Uint8Array(32),
      gate_app: 0,
      gate_prefix: new Uint8Array(),
      options: 2,
      status: STATUS.ACTIVE,
      winner: NO_WINNER,
      total_weight: 7,
      escrow: 7_000,
      voters: 2,
      open_ballots: 2,
      open_nfts: 0,
      payout_pending: 0,
      paid_to: new Uint8Array(32),
      grace: 200_000,
      ...overrides,
    },
    boxes: {
      m: META.encode(["Pick a mascot", "Community poll"]),
      t: tallyBox(5, 2),
      [boxKey(pre("o", u64(0)))]: OPTION.encode(["Cat", "Meow", BOB]),
      [boxKey(pre("o", u64(1)))]: OPTION.encode(["Dog", "Woof", CAROL]),
      [boxKey(pre("b", pk(BOB)))]: BALLOT.encode([0, 5_000, 5]),
      [boxKey(pre("b", pk(CAROL)))]: BALLOT.encode([1, 2_000, 2]),
    },
  });
}

const baseState = (s: Partial<VoteState> = {}): VoteState => ({
  appId: VOTE,
  address: algosdk.getApplicationAddress(VOTE).toString(),
  factory: FACTORY,
  registry: REGISTRY,
  voteNo: 2,
  creator: ALICE,
  mode: MODE.ESCROW,
  asset: ASSET,
  collections: [],
  unitPrefix: "",
  amountPerVote: 1_000n,
  startRound: 100,
  endRound: 200,
  returnMode: RETURN.SENDERS,
  returnAddress: algosdk.ALGORAND_ZERO_ADDRESS_STRING,
  gateApp: 0,
  gatePrefix: new Uint8Array(),
  status: STATUS.ACTIVE,
  winner: null,
  totalWeight: 7n,
  totalEscrow: 7_000n,
  voters: 2,
  openBallots: 2,
  openNfts: 0,
  payoutPending: false,
  paidTo: algosdk.ALGORAND_ZERO_ADDRESS_STRING,
  payoutGrace: 200_000,
  title: "Pick a mascot",
  description: "",
  options: [
    { index: 0, title: "Cat", description: "", recipient: BOB, weight: 5n },
    { index: 1, title: "Dog", description: "", recipient: CAROL, weight: 2n },
  ],
  programHash: "",
  ...s,
});

const BALLOTS: BallotInfo[] = [
  { voter: BOB, option: 0, amount: 5_000n, weight: 5n },
  { voter: CAROL, option: 1, amount: 2_000n, weight: 2n },
];

/** Every app call reports 2 inner txns; nothing extra needs referencing. */
const simulateOk = () => {
  chain.simulateHook = (group) => ({ txns: group.map((s: any) => ({ inner: s.txn.type === "appl" ? 2 : 0 })) });
};

describe("vote template", () => {
  it("the newest known template hash matches the compiled Vote program", () => {
    const hash = Buffer.from(sha512_256(cat(new TextEncoder().encode("Program"), VOTE_PROGRAM))).toString("hex");
    expect(KNOWN_VOTE_TEMPLATES[KNOWN_VOTE_TEMPLATES.length - 1]).toBe(hash);
  });
});

describe("voteCore reads", () => {
  it("decodes registry entries straight from the registry boxes", async () => {
    seedVote();
    const entries = await listRegistry("mainnet", REGISTRY);
    expect(entries.map((e) => e.voteNo)).toEqual([2, 1]);
    expect(entries[0]).toMatchObject({ appId: VOTE, creator: ALICE, status: STATUS.ACTIVE, winner: null, totalWeight: 7n, voters: 2 });
    expect(entries[1]).toMatchObject({ appId: 999, status: STATUS.CLOSED, winner: 1 });
    expect(decodeRegistryEntry(5, registryRecord(1, 0, 3n)).winner).toBe(3);
  });

  it("getVoteState decodes globals, metadata, options and tallies", async () => {
    seedVote();
    const s = await getVoteState("mainnet", VOTE);
    expect(s).toMatchObject({
      creator: ALICE,
      mode: MODE.ESCROW,
      asset: ASSET,
      amountPerVote: 1_000n,
      status: STATUS.ACTIVE,
      winner: null,
      totalEscrow: 7_000n,
      title: "Pick a mascot",
      description: "Community poll",
    });
    expect(s.options.map((o) => [o.title, o.recipient, o.weight])).toEqual([
      ["Cat", BOB, 5n],
      ["Dog", CAROL, 2n],
    ]);
    expect(KNOWN_VOTE_TEMPLATES).toContain(s.programHash);
  });

  it("verifyVote rejects look-alike apps that the registry doesn't point at", async () => {
    seedVote();
    const s = await getVoteState("mainnet", VOTE);
    expect(await verifyVote("mainnet", FACTORY, s)).toBe(true);
    expect(await verifyVote("mainnet", FACTORY, { ...s, appId: 4444 })).toBe(false);
    expect(await verifyVote("mainnet", 1234, s)).toBe(false);
  });

  it("lists ballots grouped by option, heaviest first, and NFT records", async () => {
    seedVote();
    chain.apps.get(VOTE)!.boxes![boxKey(pre("b", pk(ALICE)))] = BALLOT.encode([0, 9_000, 9]);
    chain.apps.get(VOTE)!.boxes![boxKey(pre("n", u64(555)))] = pk(BOB);
    const ballots = await listBallots("mainnet", VOTE);
    expect(ballots.map((b) => [b.voter, b.option, b.weight])).toEqual([
      [ALICE, 0, 9n],
      [BOB, 0, 5n],
      [CAROL, 1, 2n],
    ]);
    expect(await listNftVotes("mainnet", VOTE)).toEqual([{ assetId: 555, voter: BOB }]);
  });
});

describe("settlement plan: every token and deposit is returnable", () => {
  const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

  it("refund mode returns each voter's exact deposit and their ballot MBR", () => {
    const state = baseState({ status: STATUS.FINALIZED, winner: 0 });
    const plan = planSettlement(state, BALLOTS, [], 300);
    expect(plan.blocking).toBeNull();
    expect(plan.payout).toBeNull();
    expect(plan.refunds).toEqual([
      { voter: BOB, tokens: 5_000n, mbr: BALLOT_MBR },
      { voter: CAROL, tokens: 2_000n, mbr: BALLOT_MBR },
    ]);
    // Every escrowed token goes back to someone.
    expect(sum(plan.refunds.map((r) => r.tokens))).toBe(state.totalEscrow);
    expect(plan.closable).toBe(false);
  });

  it("a cancelled vote refunds everyone even if it was in payout mode", () => {
    // cancel() switches returnMode to SENDERS on-chain; the plan reads that state.
    const plan = planSettlement(baseState({ status: STATUS.CANCELLED, returnMode: RETURN.SENDERS }), BALLOTS, [], 150);
    expect(sum(plan.refunds.map((r) => r.tokens))).toBe(7_000n);
  });

  it("needs finalize once the end round passes", () => {
    expect(planSettlement(baseState(), BALLOTS, [], 201).blocking).toBe("finalize");
    expect(planSettlement(baseState(), BALLOTS, [], 200).blocking).toBeNull();
  });

  it("address mode pays the whole pool out first; voters only get MBR back", () => {
    const state = baseState({ status: STATUS.FINALIZED, returnMode: RETURN.ADDRESS, returnAddress: ALICE, payoutPending: true, winner: 0 });
    const plan = planSettlement(state, BALLOTS, [], 300);
    expect(plan.blocking).toBe("payout");
    expect(plan.payout).toEqual({ to: ALICE, amount: 7_000n });
    expect(plan.refunds.every((r) => r.tokens === 0n && r.mbr === BALLOT_MBR)).toBe(true);
  });

  it("winner mode pays the winning option's recipient", () => {
    const state = baseState({ status: STATUS.FINALIZED, returnMode: RETURN.WINNER, payoutPending: true, winner: 1 });
    expect(planSettlement(state, BALLOTS, [], 300).payout).toEqual({ to: CAROL, amount: 7_000n });
  });

  it("read-only modes never move tokens and refund every MBR deposit", () => {
    const nfts: NftVote[] = [
      { assetId: 11, voter: BOB },
      { assetId: 12, voter: BOB },
    ];
    const state = baseState({ mode: MODE.NFT, status: STATUS.FINALIZED, totalEscrow: 0n });
    const plan = planSettlement(state, BALLOTS, nfts, 300);
    expect(plan.refunds.every((r) => r.tokens === 0n)).toBe(true);
    expect(plan.nftReleases).toEqual([
      { assetId: 11, voter: BOB, mbr: NFT_MBR },
      { assetId: 12, voter: BOB, mbr: NFT_MBR },
    ]);
    expect(planSettlement(state, [], [], 300).closable).toBe(true);
  });
});

describe("funding estimates match the contract's box layout", () => {
  it("app deposits match the compiled schema (100k/page + 28.5k/uint + 50k/byte slice)", () => {
    const arc56 = JSON.parse(fs.readFileSync("contracts/build/vote/Vote.arc56.json", "utf8"));
    const { ints, bytes } = arc56.state.schema.global;
    const pages = Math.ceil(VOTE_PROGRAM.length / 2048);
    expect(APP_DEPOSITS.vote).toBe(100_000 * pages + 28_500 * ints + 50_000 * bytes);
  });

  it("createVote funding = app deposit + vote account + opt-in + boxes + registry entry", () => {
    const p = { mode: MODE.ESCROW, title: "Pick", description: "Go", options: [{ title: "A", description: "" }, { title: "B", description: "bb" }] };
    const meta = META.encode([p.title, p.description]).length;
    const opts = p.options.map((o) => OPTION.encode([o.title, o.description, ALICE]).length);
    const expected =
      APP_DEPOSITS.vote +
      100_000 +
      100_000 +
      boxMbr(1, meta) +
      opts.reduce((n, len) => n + boxMbr(9, len), 0) +
      boxMbr(1, 128) +
      REGISTRY_ENTRY_MBR;
    expect(estimateCreateVoteFunding(p)).toBe(expected);
    // Read-only modes skip the asset opt-in.
    expect(estimateCreateVoteFunding({ ...p, mode: MODE.HELD })).toBe(expected - 100_000);
    expect(BALLOT_MBR).toBe(boxMbr(33, BALLOT.encode([0, 0, 0]).length));
  });

  it("validateCreateVote catches what the contract would reject", () => {
    const ok = { mode: MODE.ESCROW, asset: 1, amountPerVote: 1, startRound: 0, endRound: 500, title: "T", description: "", options: [{ title: "a", description: "" }, { title: "b", description: "" }] };
    expect(validateCreateVote(ok, 100)).toBeNull();
    expect(validateCreateVote({ ...ok, options: ok.options.slice(0, 1) }, 100)).toMatch(/between 2/);
    expect(validateCreateVote({ ...ok, endRound: 50 }, 100)).toMatch(/end after/);
    expect(validateCreateVote({ ...ok, returnMode: RETURN.WINNER }, 100)).toMatch(/recipient/);
    expect(validateCreateVote({ ...ok, mode: MODE.NFT }, 100)).toMatch(/collection/);
    expect(validateCreateVote({ ...ok, description: "x".repeat(2_000) }, 100)).toMatch(/too long/);
  });
});

describe("voteCore group building", () => {
  it("createVote: funding payment to the factory + createVote call", async () => {
    seedVote();
    simulateOk();
    const p = {
      mode: MODE.HELD,
      asset: ASSET,
      amountPerVote: 10,
      startRound: 0,
      endRound: chain.round + 1_000,
      title: "Hold to vote",
      description: "",
      options: [{ title: "Yes", description: "" }, { title: "No", description: "" }],
    };
    const [pay, call] = await buildCreateVote("mainnet", FACTORY, ALICE, p);
    expect(pay.payment?.receiver.toString()).toBe(algosdk.getApplicationAddress(FACTORY).toString());
    expect(Number(pay.payment?.amount)).toBe(estimateCreateVoteFunding(p));
    expect(call.applicationCall?.appIndex).toBe(BigInt(FACTORY));
    expect(Number(call.fee)).toBe(3_000);
    expect(pay.group).toEqual(call.group);
  });

  it("escrow vote sends votes × amountPerVote plus the ballot deposit (first vote only)", async () => {
    seedVote();
    simulateOk();
    const state = await getVoteState("mainnet", VOTE);
    const [pay, axfer, call] = await buildVoteEscrow("mainnet", state, BOB, 1, 3, false);
    expect(Number(pay.payment?.amount)).toBe(BALLOT_MBR);
    expect(axfer.assetTransfer?.amount).toBe(3_000n);
    expect(axfer.assetTransfer?.receiver.toString()).toBe(state.address);
    // [selector, option]: the pay and axfer args are the preceding group txns
    expect(call.applicationCall?.appArgs?.[1]).toEqual(u64(1));
    const [again] = await buildVoteEscrow("mainnet", state, BOB, 1, 1, true);
    expect(Number(again.payment?.amount)).toBe(0);
  });

  it("held vote sends no tokens", async () => {
    seedVote({ mode: MODE.HELD });
    simulateOk();
    const txns = await buildVoteHeld("mainnet", await getVoteState("mainnet", VOTE), BOB, 0, false);
    expect(txns.map((t) => t.type)).toEqual(["pay", "appl"]);
  });

  it("NFT vote splits pieces across calls and charges one NFT deposit per piece", async () => {
    seedVote({ mode: MODE.NFT });
    simulateOk();
    const ids = Array.from({ length: 8 }, (_, i) => 100 + i);
    const txns = await buildVoteNft("mainnet", await getVoteState("mainnet", VOTE), BOB, 0, ids, false);
    expect(txns.map((t) => t.type)).toEqual(["pay", "appl", "pay", "appl"]);
    expect(Number(txns[0].payment?.amount)).toBe(BALLOT_MBR + 6 * NFT_MBR);
    expect(Number(txns[2].payment?.amount)).toBe(2 * NFT_MBR);
    expect(txns.some((t) => t.assetTransfer)).toBe(false);
  });

  it("release is batched into groups of 16 calls with unique txIDs", async () => {
    seedVote();
    simulateOk();
    const voters = Array.from({ length: 20 }, () => algosdk.generateAccount().addr.toString());
    const groups = await buildRelease("mainnet", VOTE, ALICE, voters);
    expect(groups.map((g) => g.length)).toEqual([MAX_CALLS_PER_GROUP, 4]);
    const ids = groups.flat().map((t) => t.txID());
    expect(new Set(ids).size).toBe(20);
  });

  it("parseCreateVoteResult reads the ABI return", () => {
    const ret = cat(new Uint8Array([0x15, 0x1f, 0x7c, 0x75]), u64(VOTE));
    expect(parseCreateVoteResult({ logs: [ret] } as any)).toBe(VOTE);
    expect(() => parseCreateVoteResult({ logs: [] } as any)).toThrow();
  });
});

describe("NFT collection rules", () => {
  const COLLECTION = algosdk.ABIType.from("(address[],byte[])");

  it("a piece counts when any listed wallet created it and the unit prefix matches", () => {
    expect(isCollectionPiece(ALICE, "WEN001", [BOB, ALICE], "WEN")).toBe(true);
    expect(isCollectionPiece(ALICE, "OTHER1", [BOB, ALICE], "WEN")).toBe(false);
    expect(isCollectionPiece(CAROL, "WEN001", [BOB, ALICE], "WEN")).toBe(false);
    expect(isCollectionPiece(BOB, "ANYTHING", [BOB], "")).toBe(true);
  });

  it("getVoteState reads creators and prefix from the c box", async () => {
    seedVote({ mode: MODE.NFT });
    chain.apps.get(VOTE)!.boxes!.c = COLLECTION.encode([[ALICE, BOB], new TextEncoder().encode("WEN")]);
    const s = await getVoteState("mainnet", VOTE);
    expect(s.collections).toEqual([ALICE, BOB]);
    expect(s.unitPrefix).toBe("WEN");
  });

  it("funding includes the rule box, sized like its ABI encoding", () => {
    const base = { mode: MODE.NFT, title: "T", description: "", options: [{ title: "a", description: "" }, { title: "b", description: "" }] };
    const len = COLLECTION.encode([[ALICE, BOB], new TextEncoder().encode("WEN")]).length;
    expect(estimateCreateVoteFunding({ ...base, collections: [ALICE, BOB], unitPrefix: "WEN" }) - estimateCreateVoteFunding({ ...base, collections: [] })).toBe(
      boxMbr(1, len) - boxMbr(1, COLLECTION.encode([[], new Uint8Array()]).length)
    );
  });

  it("validates creator lists", () => {
    const p = { mode: MODE.NFT, startRound: 0, endRound: 500, title: "T", description: "", options: [{ title: "a", description: "" }, { title: "b", description: "" }] };
    expect(validateCreateVote({ ...p, collections: [ALICE] }, 100)).toBeNull();
    expect(validateCreateVote({ ...p, collections: Array(9).fill(ALICE) }, 100)).toMatch(/At most 8/);
    expect(validateCreateVote({ ...p, collections: ["nope"] }, 100)).toMatch(/isn't valid/);
    expect(validateCreateVote({ ...p, collections: [ALICE], unitPrefix: "TOOLONGPREFIX" }, 100)).toMatch(/8 characters/);
  });
});

describe("keeper", () => {
  const keeper = { addr: CAROL, sign: (txns: algosdk.Transaction[]) => txns.map((t) => algosdk.signTransaction(t, sk("carol")).blob) };
  /** Balances the fake chain reports per (account, asset). */
  const holdings = (map: Record<string, number>) =>
    chain.on("GET", /\/v2\/accounts\/[A-Z2-7]{58}\/assets\/\d+/, (req) => {
      const [, acct, asset] = req.url.pathname.match(/accounts\/([A-Z2-7]{58})\/assets\/(\d+)/)!;
      const amount = map[`${acct}:${asset}`];
      return amount === undefined ? new FakeResponse(404, { message: "not opted in" }) : { round: chain.round, "asset-holding": { "asset-id": Number(asset), amount, "is-frozen": false } };
    });

  it("ignores apps the factory's registry doesn't point at", async () => {
    seedVote();
    chain.apps.get(REGISTRY)!.boxes![boxKey(pre("v", u64(2)))] = registryRecord(4444);
    const report = await keepVote("mainnet", FACTORY, keeper, VOTE);
    expect(report.note).toMatch(/not a vote/);
    expect(chain.sent).toHaveLength(0);
  });

  it("live held vote: recounts only the ballots whose wallets dropped below their weight", async () => {
    chain.round = 150;
    seedVote({ mode: MODE.HELD });
    // BOB voted 5 votes (5,000) but now holds 1,200 → stale; CAROL still holds her 2,000.
    holdings({ [`${BOB}:${ASSET}`]: 1_200, [`${CAROL}:${ASSET}`]: 2_000 });
    expect((await findStale("mainnet", await getVoteState("mainnet", VOTE))).voters).toEqual([BOB]);
    simulateOk();
    const report = await keepVote("mainnet", FACTORY, keeper, VOTE);
    expect(report.actions).toEqual(["recount 1 ballot(s)"]);
    const appArgs = chain.sent.map((s) => s.raw.txn.apaa);
    expect(appArgs[0][1]).toEqual(pk(BOB));
  });

  it("live hard vote: nothing to recount, no transactions", async () => {
    chain.round = 150;
    seedVote();
    simulateOk();
    const report = await keepVote("mainnet", FACTORY, keeper, VOTE);
    expect(report.actions).toEqual([]);
    expect(chain.sent).toHaveLength(0);
  });
});
