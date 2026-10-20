/**
 * Vote Tool — contract interaction core.
 *
 * Framework-agnostic (no React, no import.meta.env) so it is shared by the frontend
 * (src/utils/voteTool.ts), the unit tests and the testnet e2e script.
 * Contract source: contracts/VoteTool.algo.ts
 */

import algosdk from "algosdk";
import { sha512_256 } from "@noble/hashes/sha2.js";
import { finalizeGroup, getAlgod, type SaleNetwork } from "./wenpadSaleCore.js";
import { APP_DEPOSITS, VOTE_ERRORS } from "./voteTemplates.js";

export type VoteNetwork = SaleNetwork;
export { getAlgod };

// ─── Contract constants (must match contracts/VoteTool.algo.ts) ──────────────

export const MODE = { ESCROW: 0, HELD: 1, NFT: 2 } as const;
export const MODE_LABELS = ["Hard vote (tokens sent)", "Tokens held", "NFT collection"] as const;
export const RETURN = { SENDERS: 0, ADDRESS: 1, WINNER: 2 } as const;
export const RETURN_LABELS = ["Return to voters", "Send to address", "Send to winning option"] as const;
export const STATUS = { ACTIVE: 0, FINALIZED: 1, CANCELLED: 2, CLOSED: 3 } as const;
export const MAX_OPTIONS = 16;
export const NO_WINNER = 2n ** 64n - 1n;
/** Max app calls per group when batching releases / recounts. */
export const MAX_CALLS_PER_GROUP = 16;

/** Box MBR as the protocol charges it: 2,500 + 400 per byte of name + value. */
export const boxMbr = (nameLen: number, valueLen: number) => 2_500 + 400 * (nameLen + valueLen);
export const BALLOT_MBR = boxMbr(33, 24);
export const NFT_MBR = boxMbr(9, 32);
export const REGISTRY_ENTRY_MBR = boxMbr(9, 104);
const APP_BASE_MBR = 100_000;
const ASSET_OPTIN_MBR = 100_000;
const utf8Len = (s: string) => new TextEncoder().encode(s).length;

// ─── ABI ─────────────────────────────────────────────────────────────────────

const CONFIG_TYPE = "(uint64,uint64,uint64,uint64,uint64,uint64,address,uint64,byte[])";
const COLLECTION_TYPE = "(address[],byte[])";
const OPTION_TYPE = "(string,string,address)";
const method = (sig: string) => algosdk.ABIMethod.fromSignature(sig);

export const M = {
  factoryCreate: method("createApplication(uint64)void"),
  bootstrap: method("bootstrap(pay)uint64"),
  createVote: method(`createVote(pay,${CONFIG_TYPE},string,string,${OPTION_TYPE}[],${COLLECTION_TYPE})uint64`),
  createVoterList: method("createVoterList(pay)uint64"),
  listAdd: method("add(pay,address[])void"),
  listRemove: method("remove(address[])void"),
  voteEscrow: method("voteEscrow(pay,axfer,uint64)void"),
  voteHeld: method("voteHeld(pay,uint64)void"),
  voteNft: method("voteNft(pay,uint64,uint64[])void"),
  recount: method("recount(address)void"),
  recountNft: method("recountNft(uint64)void"),
  finalize: method("finalize()void"),
  payout: method("payout()void"),
  fallbackToRefunds: method("fallbackToRefunds()void"),
  cancel: method("cancel()void"),
  release: method("release(address)void"),
  releaseNft: method("releaseNft(uint64)void"),
  closeVote: method("closeVote(uint64)void"),
  closeVoterList: method("closeVoterList(uint64)void"),
};

const META_TYPE = algosdk.ABIType.from("(string,string)");
const OPTION_ABI = algosdk.ABIType.from(OPTION_TYPE);
const BALLOT_TYPE = algosdk.ABIType.from("(uint64,uint64,uint64)");
const COLLECTION_ABI = algosdk.ABIType.from(COLLECTION_TYPE);
/** Most collection creator wallets one vote accepts (contract MAX_CREATORS). */
export const MAX_CREATORS = 8;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VoteOptionInput {
  title: string;
  description: string;
  /** Required in RETURN.WINNER mode, otherwise ignored (zero address). */
  recipient?: string;
}

export interface CreateVoteParams {
  mode: number;
  /** ESCROW / HELD: vote asset. */
  asset?: number;
  /** NFT: wallets that minted the collection (1–8); a piece counts if its creator is one of them. */
  collections?: string[];
  /** NFT: optional unit-name prefix, e.g. "WEN" matches WEN001. */
  unitPrefix?: string;
  /** Base units per vote (ESCROW / HELD). */
  amountPerVote?: number | bigint;
  /** 0 = now. */
  startRound: number;
  endRound: number;
  returnMode?: number;
  returnAddress?: string;
  /** Optional voter gate: app whose boxes list allowed voters ("b" + address). */
  gateApp?: number;
  gatePrefix?: string;
  title: string;
  description: string;
  options: VoteOptionInput[];
}

export interface RegistryEntry {
  voteNo: number;
  appId: number;
  creator: string;
  mode: number;
  asset: number;
  startRound: number;
  endRound: number;
  status: number;
  /** null = no winner (yet, or tie). */
  winner: number | null;
  totalWeight: bigint;
  voters: number;
}

export interface VoteOptionState {
  index: number;
  title: string;
  description: string;
  recipient: string;
  weight: bigint;
}

export interface VoteState {
  appId: number;
  address: string;
  factory: number;
  registry: number;
  voteNo: number;
  creator: string;
  mode: number;
  asset: number;
  /** NFT mode: collection creator wallets and unit-name prefix ("" = any). */
  collections: string[];
  unitPrefix: string;
  amountPerVote: bigint;
  startRound: number;
  endRound: number;
  returnMode: number;
  returnAddress: string;
  gateApp: number;
  gatePrefix: Uint8Array;
  status: number;
  winner: number | null;
  totalWeight: bigint;
  totalEscrow: bigint;
  voters: number;
  openBallots: number;
  openNfts: number;
  payoutPending: boolean;
  paidTo: string;
  payoutGrace: number;
  title: string;
  description: string;
  options: VoteOptionState[];
  /** sha512_256 of the approval program, hex. Compare with known templates. */
  programHash: string;
}

export interface BallotInfo {
  voter: string;
  option: number;
  amount: bigint;
  weight: bigint;
}

export interface NftVote {
  assetId: number;
  voter: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const u64 = (n: number | bigint) => algosdk.encodeUint64(n);
const enc = new TextEncoder();
const prefixed = (prefix: string, ...parts: Uint8Array[]) => {
  const head = enc.encode(prefix);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, head.length));
  out.set(head, 0);
  let o = head.length;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const readU64 = (b: Uint8Array, off: number) => algosdk.decodeUint64(b.slice(off, off + 8), "bigint");
const toAddr = (b: Uint8Array) => algosdk.encodeAddress(b);
const ZERO_ADDRESS = algosdk.ALGORAND_ZERO_ADDRESS_STRING;
const emptySigner = algosdk.makeEmptyTransactionSigner();

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Decode an algod global-state array into key → uint | bytes. */
function readGlobals(state: any[] | undefined) {
  const out: Record<string, bigint | Uint8Array> = {};
  for (const kv of state ?? []) {
    const key = new TextDecoder().decode(kv.key);
    out[key] = kv.value.type === 1 ? (kv.value.bytes as Uint8Array) : BigInt(kv.value.uint);
  }
  return out;
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/** Registry record: 104 bytes, see REC_* offsets in the contract. */
export function decodeRegistryEntry(voteNo: number, value: Uint8Array): RegistryEntry {
  const winner = readU64(value, 80);
  return {
    voteNo,
    appId: Number(readU64(value, 0)),
    creator: toAddr(value.slice(8, 40)),
    mode: Number(readU64(value, 40)),
    asset: Number(readU64(value, 48)),
    startRound: Number(readU64(value, 56)),
    endRound: Number(readU64(value, 64)),
    status: Number(readU64(value, 72)),
    winner: winner === NO_WINNER ? null : Number(winner),
    totalWeight: readU64(value, 88),
    voters: Number(readU64(value, 96)),
  };
}

export async function getFactoryInfo(network: VoteNetwork, factoryId: number) {
  const app = await getAlgod(network).getApplicationByID(factoryId).do();
  const g = readGlobals(app.params?.globalState);
  return {
    admin: g.admin instanceof Uint8Array ? toAddr(g.admin) : "",
    registry: Number(g.registry ?? 0n),
    totalVotes: Number(g.total_votes ?? 0n),
    totalLists: Number(g.total_lists ?? 0n),
    payoutGrace: Number(g.grace ?? 0n),
  };
}

/** Every vote ever created, straight from the registry's boxes (no database). Newest first. */
export async function listRegistry(network: VoteNetwork, registryId: number): Promise<RegistryEntry[]> {
  if (!registryId) return [];
  const algod = getAlgod(network);
  const { boxes } = await algod.getApplicationBoxes(registryId).max(10_000).do();
  const voteNos = boxes
    .map((b) => b.name)
    .filter((n) => n.length === 9 && n[0] === "v".charCodeAt(0))
    .map((n) => Number(readU64(n, 1)));
  const entries = await mapLimit(voteNos, 8, async (voteNo) => {
    try {
      const box = await algod.getApplicationBoxByName(registryId, prefixed("v", u64(voteNo))).do();
      return decodeRegistryEntry(voteNo, box.value);
    } catch {
      return null;
    }
  });
  return entries.filter((e): e is RegistryEntry => e !== null).sort((a, b) => b.voteNo - a.voteNo);
}

/** Title of a vote (null once the vote has been closed and its boxes deleted). */
export async function getVoteTitle(network: VoteNetwork, appId: number): Promise<string | null> {
  try {
    const box = await getAlgod(network).getApplicationBoxByName(appId, enc.encode("m")).do();
    return (META_TYPE.decode(box.value) as [string, string])[0];
  } catch {
    return null;
  }
}

export async function getVoteState(network: VoteNetwork, appId: number): Promise<VoteState> {
  const algod = getAlgod(network);
  const app = await algod.getApplicationByID(appId).do();
  const g = readGlobals(app.params?.globalState);
  const num = (k: string) => Number((g[k] as bigint) ?? 0n);
  const big = (k: string) => (g[k] as bigint) ?? 0n;
  const addr = (k: string) => (g[k] instanceof Uint8Array ? toAddr(g[k] as Uint8Array) : ZERO_ADDRESS);
  const optionCount = num("options");

  let collections: string[] = [];
  let unitPrefix = "";
  if (num("mode") === MODE.NFT) {
    try {
      const box = await algod.getApplicationBoxByName(appId, enc.encode("c")).do();
      const [creators, prefix] = COLLECTION_ABI.decode(box.value) as [string[], ArrayLike<number>];
      collections = creators;
      // algosdk decodes byte[] as number[], not Uint8Array
      unitPrefix = new TextDecoder().decode(Uint8Array.from(prefix));
    } catch {
      // closed vote
    }
  }

  let title = "";
  let description = "";
  let tally = new Uint8Array(MAX_OPTIONS * 8);
  const options: VoteOptionState[] = [];
  try {
    const [metaBox, tallyBox] = await Promise.all([
      algod.getApplicationBoxByName(appId, enc.encode("m")).do(),
      algod.getApplicationBoxByName(appId, enc.encode("t")).do(),
    ]);
    [title, description] = META_TYPE.decode(metaBox.value) as [string, string];
    tally = tallyBox.value;
    const optionBoxes = await mapLimit(
      Array.from({ length: optionCount }, (_, i) => i),
      8,
      (i) => algod.getApplicationBoxByName(appId, prefixed("o", u64(i))).do()
    );
    optionBoxes.forEach((box, i) => {
      const [t, d, r] = OPTION_ABI.decode(box.value) as [string, string, string];
      options.push({ index: i, title: t, description: d, recipient: r, weight: readU64(tally, i * 8) });
    });
  } catch {
    // Closed votes have no boxes left; the registry still has the outcome.
  }

  const winner = big("winner");
  const program = (app.params?.approvalProgram as Uint8Array) ?? new Uint8Array();
  const programHash = toHex(sha512_256(prefixed("Program", program)));

  return {
    appId,
    address: algosdk.getApplicationAddress(appId).toString(),
    factory: num("factory"),
    registry: num("registry"),
    voteNo: num("vote_no"),
    creator: addr("creator"),
    mode: num("mode"),
    asset: num("asset"),
    collections,
    unitPrefix,
    amountPerVote: big("apv"),
    startRound: num("start"),
    endRound: num("end"),
    returnMode: num("return_mode"),
    returnAddress: addr("return_addr"),
    gateApp: num("gate_app"),
    gatePrefix: (g.gate_prefix as Uint8Array) ?? new Uint8Array(),
    status: num("status"),
    winner: winner === NO_WINNER ? null : Number(winner),
    totalWeight: big("total_weight"),
    totalEscrow: big("escrow"),
    voters: num("voters"),
    openBallots: num("open_ballots"),
    openNfts: num("open_nfts"),
    payoutPending: big("payout_pending") === 1n,
    paidTo: addr("paid_to"),
    payoutGrace: num("grace"),
    title,
    description,
    options,
    programHash,
  };
}

/**
 * Confirm an app really is a vote from this factory: its `factory` global matches and the registry
 * entry it claims points back at it. A look-alike app can copy globals but not the registry entry.
 */
export async function verifyVote(network: VoteNetwork, factoryId: number, state: VoteState): Promise<boolean> {
  if (state.factory !== factoryId) return false;
  const { registry } = await getFactoryInfo(network, factoryId);
  if (registry !== state.registry) return false;
  try {
    const box = await getAlgod(network).getApplicationBoxByName(registry, prefixed("v", u64(state.voteNo))).do();
    return decodeRegistryEntry(state.voteNo, box.value).appId === state.appId;
  } catch {
    return false;
  }
}

/** Every open ballot ("b" + address boxes). */
export async function listBallots(network: VoteNetwork, appId: number): Promise<BallotInfo[]> {
  const algod = getAlgod(network);
  const { boxes } = await algod.getApplicationBoxes(appId).max(10_000).do();
  const names = boxes.map((b) => b.name).filter((n) => n.length === 33 && n[0] === "b".charCodeAt(0));
  const ballots = await mapLimit(names, 8, async (name) => {
    const box = await algod.getApplicationBoxByName(appId, name).do();
    const [option, amount, weight] = BALLOT_TYPE.decode(box.value) as [bigint, bigint, bigint];
    return { voter: toAddr(name.slice(1)), option: Number(option), amount, weight };
  });
  return ballots.sort((a, b) => a.option - b.option || (b.weight > a.weight ? 1 : b.weight < a.weight ? -1 : 0));
}

/** NFT mode: which pieces have been counted, and by whom ("n" + assetId boxes). */
export async function listNftVotes(network: VoteNetwork, appId: number): Promise<NftVote[]> {
  const algod = getAlgod(network);
  const { boxes } = await algod.getApplicationBoxes(appId).max(10_000).do();
  const names = boxes.map((b) => b.name).filter((n) => n.length === 9 && n[0] === "n".charCodeAt(0));
  return mapLimit(names, 8, async (name) => {
    const box = await algod.getApplicationBoxByName(appId, name).do();
    return { assetId: Number(readU64(name, 1)), voter: toAddr(box.value) };
  });
}

// ─── Settlement planning (what everyone gets back) ───────────────────────────

export interface SettlementPlan {
  /** Next call that must happen before releases (finalize / payout), if any. */
  blocking: "finalize" | "payout" | null;
  /** Escrowed tokens sent to one address (payout modes). */
  payout: { to: string; amount: bigint } | null;
  /** Per-voter returns when each ballot is released. */
  refunds: { voter: string; tokens: bigint; mbr: number }[];
  nftReleases: { assetId: number; voter: string; mbr: number }[];
  /** True once every ballot and NFT record has been released and close() can run. */
  closable: boolean;
}

/**
 * Pure function of the on-chain state: who gets what back, in what order. The UI shows it and the
 * tests check it adds up (every escrowed token accounted for, every MBR deposit refunded).
 */
export function planSettlement(state: VoteState, ballots: BallotInfo[], nfts: NftVote[], currentRound: number): SettlementPlan {
  const ended = state.status === STATUS.FINALIZED || state.status === STATUS.CANCELLED;
  const needsFinalize = state.status === STATUS.ACTIVE && currentRound > state.endRound;
  const refundsTokens = state.mode === MODE.ESCROW && state.returnMode === RETURN.SENDERS;

  let payout: SettlementPlan["payout"] = null;
  if (state.mode === MODE.ESCROW && state.totalEscrow > 0n && state.returnMode !== RETURN.SENDERS) {
    if (state.returnMode === RETURN.ADDRESS) payout = { to: state.returnAddress, amount: state.totalEscrow };
    else if (state.winner !== null) payout = { to: state.options[state.winner]?.recipient ?? ZERO_ADDRESS, amount: state.totalEscrow };
  }

  return {
    blocking: needsFinalize ? "finalize" : ended && state.payoutPending ? "payout" : null,
    payout: ended || needsFinalize ? payout : null,
    refunds: ballots.map((b) => ({ voter: b.voter, tokens: refundsTokens ? b.amount : 0n, mbr: BALLOT_MBR })),
    nftReleases: nfts.map((n) => ({ ...n, mbr: NFT_MBR })),
    closable: ended && !state.payoutPending && ballots.length === 0 && nfts.length === 0,
  };
}

// ─── Funding estimates ───────────────────────────────────────────────────────

/** Exact ALGO the creator sends with createVote. The vote refunds anything unused in the same call. */
export function estimateCreateVoteFunding(p: Pick<CreateVoteParams, "mode" | "title" | "description" | "options" | "collections" | "unitPrefix">): number {
  const meta = boxMbr(1, 4 + 2 + utf8Len(p.title) + 2 + utf8Len(p.description));
  const options = p.options.reduce((n, o) => n + boxMbr(9, 36 + 2 + utf8Len(o.title) + 2 + utf8Len(o.description)), 0);
  const tally = boxMbr(1, MAX_OPTIONS * 8);
  const optIn = p.mode === MODE.ESCROW ? ASSET_OPTIN_MBR : 0;
  // NFT rule box "c": ABI (address[], byte[]) = 4 head + 2 + 32/creator + 2 + prefix
  const rule = p.mode === MODE.NFT ? boxMbr(1, 4 + 2 + 32 * (p.collections?.length ?? 0) + 2 + utf8Len(p.unitPrefix ?? "")) : 0;
  // APP_DEPOSITS.vote is charged to the factory (the app's creator) and refunded by closeVote.
  return APP_DEPOSITS.vote + APP_BASE_MBR + optIn + meta + options + tally + rule + REGISTRY_ENTRY_MBR;
}

/** ALGO deposit a voter sends with a vote (refunded when the ballot is released). */
export function voteDeposit(hasBallot: boolean, newNfts = 0) {
  return (hasBallot ? 0 : BALLOT_MBR) + newNfts * NFT_MBR;
}

// ─── Group building ──────────────────────────────────────────────────────────

function methodCall(
  appId: number,
  m: algosdk.ABIMethod,
  sender: string,
  sp: algosdk.SuggestedParams,
  args: algosdk.ABIArgument[] = [],
  onComplete: algosdk.OnApplicationComplete = algosdk.OnApplicationComplete.NoOpOC
): algosdk.Transaction[] {
  const atc = new algosdk.AtomicTransactionComposer();
  atc.addMethodCall({ appID: appId, method: m, methodArgs: args, sender, suggestedParams: sp, signer: emptySigner, onComplete });
  return atc.buildGroup().map((t) => {
    t.txn.group = undefined;
    return t.txn;
  });
}

interface ErrorContext {
  /** Failures reported by this app ID are looked up in the factory's error map. */
  factoryId?: number;
  /** Map for every other app in the group (default: the Vote program). */
  program?: "vote" | "list";
}

/**
 * algod reports a failed assert as "pc=N" only. Turn it back into the contract's message using
 * the pc → message maps generated at build time.
 */
export function explainVoteError(msg: string, ctx: ErrorContext = {}): string {
  const pc = msg.match(/pc=(\d+)/);
  if (!pc) return msg;
  const app = msg.match(/app=(\d+)/);
  const program = app && ctx.factoryId && Number(app[1]) === ctx.factoryId ? "factory" : ctx.program ?? "vote";
  const reason = VOTE_ERRORS[program][Number(pc[1])];
  return reason ? `The contract rejected this: ${reason}.` : msg;
}

async function finalize(algod: algosdk.Algodv2, txns: algosdk.Transaction[], ctx: ErrorContext = {}) {
  // Every Vote Tool app has a no-op opUp(); when a group runs out of reference slots (closeVote,
  // NFT votes), finalizeGroup pads it with opUp calls to the group's first app.
  const call = txns.find((t) => t.type === algosdk.TransactionType.appl);
  const opUp = call ? { appId: Number(call.applicationCall!.appIndex), sender: call.sender.toString() } : undefined;
  try {
    return await finalizeGroup(algod, txns, opUp);
  } catch (err: any) {
    throw new Error(explainVoteError(String(err?.message || err), ctx));
  }
}

const payTxn = (from: string, to: string, amount: number, sp: algosdk.SuggestedParams) =>
  algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: from, receiver: to, amount, suggestedParams: sp });

const appAddr = (appId: number) => algosdk.getApplicationAddress(appId).toString();

/** Validate inputs the contract would reject, with messages a person can act on. */
export function validateCreateVote(p: CreateVoteParams, currentRound: number): string | null {
  if (!p.title.trim()) return "Give the vote a title.";
  if (p.options.length < 2 || p.options.length > MAX_OPTIONS) return `Add between 2 and ${MAX_OPTIONS} options.`;
  if (p.options.some((o) => !o.title.trim())) return "Every option needs a title.";
  const start = p.startRound || currentRound;
  if (p.startRound && p.startRound < currentRound) return "The start round is in the past.";
  if (p.endRound <= start) return "The vote must end after it starts.";
  if (p.mode === MODE.NFT) {
    const creators = p.collections ?? [];
    if (creators.length === 0) return "Enter at least one collection creator address.";
    if (creators.length > MAX_CREATORS) return `At most ${MAX_CREATORS} collection creator wallets.`;
    if (creators.some((c) => !algosdk.isValidAddress(c))) return "One of the collection creator addresses isn't valid.";
    if (utf8Len(p.unitPrefix ?? "") > 8) return "Keep the unit name prefix to 8 characters or fewer (unit names are at most 8).";
  } else {
    if (!p.asset) return "Enter the asset ID used to vote.";
    if (!p.amountPerVote || BigInt(p.amountPerVote) <= 0n) return "Amount per vote must be more than 0.";
  }
  if (p.mode === MODE.ESCROW && p.returnMode === RETURN.ADDRESS && !(p.returnAddress && algosdk.isValidAddress(p.returnAddress)))
    return "Enter the address that receives the tokens.";
  if (p.mode === MODE.ESCROW && p.returnMode === RETURN.WINNER && p.options.some((o) => !o.recipient || !algosdk.isValidAddress(o.recipient)))
    return "Every option needs a recipient address in this mode.";
  // App args are capped at 2 KB per call; createVote forwards everything to the vote's init().
  const argBytes =
    utf8Len(p.title) + utf8Len(p.description) + p.options.reduce((n, o) => n + utf8Len(o.title) + utf8Len(o.description) + 36, 0) + 32 * (p.collections?.length ?? 0);
  if (argBytes > 1_800) return "Titles and descriptions are too long to fit in one transaction. Shorten them.";
  return null;
}

export async function buildCreateVote(network: VoteNetwork, factoryId: number, sender: string, p: CreateVoteParams) {
  const algod = getAlgod(network);
  const sp = await algod.getTransactionParams().do();
  const funding = payTxn(sender, appAddr(factoryId), estimateCreateVoteFunding(p), sp);
  const config = [
    p.mode,
    p.asset ?? 0,
    BigInt(p.amountPerVote ?? 0),
    p.startRound,
    p.endRound,
    p.mode === MODE.ESCROW ? p.returnMode ?? RETURN.SENDERS : RETURN.SENDERS,
    p.returnAddress || ZERO_ADDRESS,
    p.gateApp ?? 0,
    enc.encode(p.gateApp ? p.gatePrefix ?? "b" : ""),
  ];
  const options = p.options.map((o) => [o.title, o.description, o.recipient || ZERO_ADDRESS]);
  const txns = methodCall(factoryId, M.createVote, sender, sp, [
    { txn: funding, signer: emptySigner },
    config,
    p.title,
    p.description,
    options,
    [p.mode === MODE.NFT ? p.collections ?? [] : [], enc.encode(p.mode === MODE.NFT ? p.unitPrefix ?? "" : "")],
  ]);
  return finalize(algod, txns, { factoryId });
}

/** Read the new vote's app ID from the confirmed createVote call (ABI return). */
export function parseCreateVoteResult(confirmation: algosdk.modelsv2.PendingTransactionResponse): number {
  const logs: Uint8Array[] = confirmation.logs || [];
  const ret = logs[logs.length - 1];
  if (!ret || ret.length !== 12) throw new Error("createVote returned no app ID");
  return Number(readU64(ret, 4));
}

export async function buildVoteEscrow(network: VoteNetwork, state: VoteState, voter: string, option: number, votes: number, hasBallot: boolean) {
  const algod = getAlgod(network);
  const sp = await algod.getTransactionParams().do();
  const deposit = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: voter,
    receiver: state.address,
    assetIndex: state.asset,
    amount: BigInt(votes) * state.amountPerVote,
    suggestedParams: sp,
  });
  const txns = methodCall(state.appId, M.voteEscrow, voter, sp, [
    { txn: payTxn(voter, state.address, voteDeposit(hasBallot), sp), signer: emptySigner },
    { txn: deposit, signer: emptySigner },
    option,
  ]);
  return finalize(algod, txns);
}

export async function buildVoteHeld(network: VoteNetwork, state: VoteState, voter: string, option: number, hasBallot: boolean) {
  const algod = getAlgod(network);
  const sp = await algod.getTransactionParams().do();
  const txns = methodCall(state.appId, M.voteHeld, voter, sp, [
    { txn: payTxn(voter, state.address, voteDeposit(hasBallot), sp), signer: emptySigner },
    option,
  ]);
  return finalize(algod, txns);
}

/** NFT vote. Pieces are split over several calls in one group (reference limits), max 16 txns. */
export const NFTS_PER_CALL = 6;
export async function buildVoteNft(network: VoteNetwork, state: VoteState, voter: string, option: number, assetIds: number[], hasBallot: boolean) {
  const algod = getAlgod(network);
  const sp = await algod.getTransactionParams().do();
  const chunks: number[][] = [];
  for (let i = 0; i < assetIds.length; i += NFTS_PER_CALL) chunks.push(assetIds.slice(i, i + NFTS_PER_CALL));
  if (chunks.length === 0) chunks.push([]);
  if (chunks.length * 2 > 16) throw new Error(`At most ${8 * NFTS_PER_CALL} pieces per transaction group. Vote in batches.`);
  const txns = chunks.flatMap((chunk, i) =>
    methodCall(state.appId, M.voteNft, voter, sp, [
      { txn: payTxn(voter, state.address, voteDeposit(hasBallot || i > 0, chunk.length), sp), signer: emptySigner },
      option,
      chunk,
    ])
  );
  return finalize(algod, txns);
}

/** Simple no-arg calls: finalize, payout, fallbackToRefunds, cancel. */
export async function buildAction(network: VoteNetwork, appId: number, sender: string, action: "finalize" | "payout" | "fallbackToRefunds" | "cancel") {
  const algod = getAlgod(network);
  const sp = await algod.getTransactionParams().do();
  return finalize(algod, methodCall(appId, M[action], sender, sp));
}

/** Batch calls of one method over many args, split into groups of MAX_CALLS_PER_GROUP. */
async function buildBatches(network: VoteNetwork, appId: number, sender: string, m: algosdk.ABIMethod, args: (string | number)[]) {
  const algod = getAlgod(network);
  const sp = await algod.getTransactionParams().do();
  const groups: algosdk.Transaction[][] = [];
  for (let i = 0; i < args.length; i += MAX_CALLS_PER_GROUP) {
    const txns = args.slice(i, i + MAX_CALLS_PER_GROUP).flatMap((a) => {
      const [t] = methodCall(appId, m, sender, sp, [a]);
      return [t];
    });
    groups.push(await finalize(algod, txns));
  }
  return groups;
}

export const buildRelease = (network: VoteNetwork, appId: number, sender: string, voters: string[]) =>
  buildBatches(network, appId, sender, M.release, voters);
export const buildReleaseNfts = (network: VoteNetwork, appId: number, sender: string, assetIds: number[]) =>
  buildBatches(network, appId, sender, M.releaseNft, assetIds);
export const buildRecount = (network: VoteNetwork, appId: number, sender: string, voters: string[]) =>
  buildBatches(network, appId, sender, M.recount, voters);
export const buildRecountNfts = (network: VoteNetwork, appId: number, sender: string, assetIds: number[]) =>
  buildBatches(network, appId, sender, M.recountNft, assetIds);

/**
 * Close a finished vote through the factory: the vote app is deleted (its ALGO and stray tokens go
 * to the creator) and the factory refunds the app creation deposit to the creator as well.
 */
export async function buildClose(network: VoteNetwork, factoryId: number, appId: number, sender: string) {
  const algod = getAlgod(network);
  const sp = await algod.getTransactionParams().do();
  return finalize(algod, methodCall(factoryId, M.closeVote, sender, sp, [appId]), { factoryId });
}

// ─── Voter lists ─────────────────────────────────────────────────────────────

/** List app creation deposit (held by the factory) + the list account's base balance. */
export const VOTER_LIST_FUNDING = APP_DEPOSITS.list + APP_BASE_MBR;
export const VOTER_ENTRY_MBR = boxMbr(33, 1);

export async function buildCreateVoterList(network: VoteNetwork, factoryId: number, sender: string) {
  const algod = getAlgod(network);
  const sp = await algod.getTransactionParams().do();
  const txns = methodCall(factoryId, M.createVoterList, sender, sp, [
    { txn: payTxn(sender, appAddr(factoryId), VOTER_LIST_FUNDING, sp), signer: emptySigner },
  ]);
  return finalize(algod, txns, { factoryId, program: "list" });
}

/** Add addresses (max 60 per call so the ABI array fits in one app call). */
export async function buildVoterListAdd(network: VoteNetwork, listId: number, owner: string, addresses: string[]) {
  const algod = getAlgod(network);
  const sp = await algod.getTransactionParams().do();
  const txns: algosdk.Transaction[] = [];
  for (let i = 0; i < addresses.length; i += 60) {
    const chunk = addresses.slice(i, i + 60);
    txns.push(
      ...methodCall(listId, M.listAdd, owner, sp, [
        { txn: payTxn(owner, appAddr(listId), chunk.length * VOTER_ENTRY_MBR, sp), signer: emptySigner },
        chunk,
      ])
    );
  }
  return finalize(algod, txns, { program: "list" });
}

/** Remove addresses (their box deposits go back to the owner). */
export async function buildVoterListRemove(network: VoteNetwork, listId: number, owner: string, addresses: string[]) {
  const algod = getAlgod(network);
  const sp = await algod.getTransactionParams().do();
  const txns: algosdk.Transaction[] = [];
  for (let i = 0; i < addresses.length; i += 60) txns.push(...methodCall(listId, M.listRemove, owner, sp, [addresses.slice(i, i + 60)]));
  return finalize(algod, txns, { program: "list" });
}

/** Delete an empty voter list through the factory; every deposit goes back to the owner. */
export async function buildCloseVoterList(network: VoteNetwork, factoryId: number, listId: number, owner: string) {
  const algod = getAlgod(network);
  const sp = await algod.getTransactionParams().do();
  return finalize(algod, methodCall(factoryId, M.closeVoterList, owner, sp, [listId]), { factoryId, program: "list" });
}

// ─── Wallet reads ────────────────────────────────────────────────────────────

/** Balance of an asset in a wallet (base units), or null if not opted in. */
export async function getAssetBalance(network: VoteNetwork, address: string, assetId: number): Promise<bigint | null> {
  try {
    const r = await getAlgod(network).accountAssetInformation(address, assetId).do();
    return BigInt(r.assetHolding?.amount ?? 0);
  } catch {
    return null;
  }
}

/** Same test as the contract: creator in the list, and unit name starts with the prefix (if any). */
export const isCollectionPiece = (creator: string, unitName: string, collections: string[], unitPrefix: string) =>
  collections.includes(creator) && unitName.startsWith(unitPrefix);

/** Pieces of a collection held by `address` (any of the creator wallets, optional unit prefix). */
export async function getHeldCollectionPieces(network: VoteNetwork, address: string, collections: string[], unitPrefix = ""): Promise<number[]> {
  const info = await getAlgod(network).accountInformation(address).do();
  const held = (info.assets ?? []).filter((a) => BigInt(a.amount) > 0n).map((a) => Number(a.assetId));
  if (held.length === 0) return [];
  const params = await mapLimit(held, 8, async (id) => {
    try {
      const a = await getAlgod(network).getAssetByID(id).do();
      return { creator: a.params?.creator.toString() ?? "", unit: a.params?.unitName ?? "" };
    } catch {
      return { creator: "", unit: "" };
    }
  });
  return held.filter((_, i) => isCollectionPiece(params[i].creator, params[i].unit, collections, unitPrefix));
}

export const roundsToSeconds = (rounds: number, secondsPerRound = 2.8) => Math.round(rounds * secondsPerRound);
export const MODE_SUMMARY: Record<number, string> = {
  [MODE.ESCROW]: "Voters send tokens to the vote contract. They come back (or go to the payout) when it ends.",
  [MODE.HELD]: "Nothing is sent. Vote weight is read from each voter's wallet.",
  [MODE.NFT]: "Nothing is sent. Each piece of the collection held is one vote.",
};
