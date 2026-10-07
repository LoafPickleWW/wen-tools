/**
 * WenPad Random Sale — contract interaction core.
 *
 * Framework-agnostic (no React, no import.meta.env) so it is shared by the frontend
 * (src/utils/wenpadSale.ts) and the keeper endpoint (api/wenpad-reveal.ts).
 * Contract source: contracts/WenPadSale.algo.ts
 */

import algosdk from "algosdk";
import { populateAppCallResources } from "@algorandfoundation/algokit-utils";
import { sha512_256 } from "@noble/hashes/sha2.js";

// ─── Config ──────────────────────────────────────────────────────────────────

export type SaleNetwork = "mainnet" | "testnet";

export const ALGOD_URLS: Record<SaleNetwork, string> = {
  mainnet: "https://mainnet-api.4160.nodely.dev",
  testnet: "https://testnet-api.4160.nodely.dev",
};

export const INDEXER_URLS: Record<SaleNetwork, string> = {
  mainnet: "https://mainnet-idx.algonode.cloud",
  testnet: "https://testnet-idx.algonode.cloud",
};

export const ARC59_ROUTER_IDS: Record<SaleNetwork, number> = {
  mainnet: 2449590623,
  testnet: 643020148,
};

export const IPFS_GATEWAY = "https://ipfs.algonode.xyz/ipfs/";

export const getAlgod = (network: SaleNetwork) => new algosdk.Algodv2("", ALGOD_URLS[network], "");

// ─── Contract constants (must match contracts/WenPadSale.algo.ts) ────────────

export const STATUS = { SETUP: 0, LIVE: 1, PAUSED: 2, RELEASED: 3 } as const;
export const STATUS_LABELS = ["Setup", "Live", "Paused", "Released"] as const;

export const MIN_DELIVERY_BUDGET = 400_000;
export const MIN_REVEAL_FEE = 20_000;
export const REVEAL_WINDOW = 1000;
export const PAGE_ITEMS = 128;
/** Items per addItems call: 4-byte selector + 2-byte length + 8 bytes per item must fit in 2048 bytes */
export const MAX_ITEMS_PER_CALL = 250;

const boxMbr = (keyLen: number, valueLen: number) => 2_500 + 400 * (keyLen + valueLen);

export const ITEM_PAGE_MBR = boxMbr(9, 1024);
/** Commit box: 9-byte key + (address, 5 x uint64) */
export const COMMIT_BOX_MBR = boxMbr(9, 72);
const CHILD_SEED = 200_000;
// Child app MBR charged to the factory: 2 pages + 15 uints + 2 byte slices
const CHILD_APP_MBR = 100_000 * 2 + 28_500 * 15 + 50_000 * 2;

/** Payout split limits (must match the contract) */
export const MAX_PAYOUTS = 5;
export const BPS_TOTAL = 10_000;

/** Average Algorand round time used for date <-> round estimates */
export const AVG_ROUND_SECONDS = 2.8;

// ─── ABI ─────────────────────────────────────────────────────────────────────

const method = (sig: string) => algosdk.ABIMethod.fromSignature(sig);

const M = {
  createSale: method(
    "createSale(pay,address,byte[],uint64,uint64,uint64,uint64,uint64,string,string,string,string)uint64"
  ),
  updateMetadata: method("updateMetadata(pay,uint64,string,string,string,string)void"),
  deleteSale: method("deleteSale(uint64)void"),
  addItems: method("addItems(pay,byte[])void"),
  register: method("register()void"),
  pause: method("pause()void"),
  unpause: method("unpause()void"),
  setPrice: method("setPrice(uint64)void"),
  setEndRound: method("setEndRound(uint64)void"),
  commit: method("commit(pay)uint64"),
  reveal: method("reveal(uint64)void"),
  cancelExpired: method("cancelExpired(uint64)void"),
  release: method("release()void"),
  withdrawProceeds: method("withdrawProceeds()void"),
  deleteItemPage: method("deleteItemPage(uint64)void"),
  opUp: method("opUp()void"),
};

const SALE_RECORD_TYPE = algosdk.ABIType.from(
  "(uint64,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64)"
);
const SALE_METADATA_TYPE = algosdk.ABIType.from("(string,string,string,string)");
const COMMIT_TYPE = algosdk.ABIType.from("(address,uint64,uint64,uint64,uint64,uint64)");
const REVEALED_TYPE = algosdk.ABIType.from("(uint64,address,uint64,uint64)");

/** ARC-28 event selector: first 4 bytes of sha512_256("Name(types)") */
const eventSelector = (signature: string) => sha512_256(new TextEncoder().encode(signature)).slice(0, 4);
const REVEALED_SELECTOR = eventSelector("Revealed(uint64,address,uint64,uint64)");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SaleMetadata {
  name: string;
  unitName: string;
  standard: string;
  metadataUrl: string;
}

export interface PayoutSplit {
  address: string;
  /** Share in basis points (10,000 = 100%) */
  bps: number;
}

export interface SaleRecord {
  saleId: number;
  appId: number;
  admin: string;
  distribution: string;
  /** Primary payout recipient; the full split is read with getPayouts */
  payout: string;
  price: number;
  startRound: number;
  endRound: number;
  totalItems: number;
  sold: number;
  status: number;
  createdRound: number;
  /** Total µALGO paid for delivered items, at the price each buyer paid */
  volume: number;
}

export interface SaleListing extends SaleRecord {
  metadata: SaleMetadata;
}

/** Live state read from the sale app's global state */
export interface SaleState {
  appId: number;
  saleId: number;
  factory: number;
  admin: string;
  distribution: string;
  price: number;
  startRound: number;
  endRound: number;
  revealFee: number;
  deliveryBudget: number;
  status: number;
  total: number;
  remaining: number;
  pending: number;
  sold: number;
  proceeds: number;
  nextCommit: number;
}

export interface CommitInfo {
  commitId: number;
  buyer: string;
  targetRound: number;
  price: number;
  revealFee: number;
  deposit: number;
  boxMbr: number;
}

/** Collection-level metadata JSON referenced by SaleMetadata.metadataUrl */
export interface CollectionJson {
  name?: string;
  description?: string;
  image?: string;
  banner_image?: string;
  external_url?: string;
  unit_name?: string;
  standard?: string;
  creator?: string;
  socials?: { twitter?: string; discord?: string; telegram?: string };
}

// ─── Encoding helpers ────────────────────────────────────────────────────────

const u64 = (n: number | bigint) => algosdk.encodeUint64(n);

const concatBytes = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

const prefixed = (prefix: string, ...parts: Uint8Array[]) =>
  concatBytes(new TextEncoder().encode(prefix), ...parts);

const num = (v: unknown) => Number(v as bigint);

export const ipfsToHttp = (url: string) => {
  if (!url) return "";
  if (url.startsWith("ipfs://")) return IPFS_GATEWAY + url.slice(7).replace(/^ipfs\//, "");
  return url;
};

export const microToAlgo = (micro: number) => micro / 1_000_000;
export const algoToMicro = (algo: number) => Math.round(algo * 1_000_000);

// ─── Reads ───────────────────────────────────────────────────────────────────

function decodeSaleRecord(saleId: number, value: Uint8Array): SaleRecord {
  const v = SALE_RECORD_TYPE.decode(value) as unknown[];
  return {
    saleId,
    appId: num(v[0]),
    admin: v[1] as string,
    distribution: v[2] as string,
    payout: v[3] as string,
    price: num(v[4]),
    startRound: num(v[5]),
    endRound: num(v[6]),
    totalItems: num(v[7]),
    sold: num(v[8]),
    status: num(v[9]),
    createdRound: num(v[10]),
    volume: num(v[11]),
  };
}

function decodeMetadata(value: Uint8Array): SaleMetadata {
  const v = SALE_METADATA_TYPE.decode(value) as string[];
  return { name: v[0], unitName: v[1], standard: v[2], metadataUrl: v[3] };
}

/** Run async tasks with bounded concurrency */
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

/** Read every sale from the factory index (s<saleId> + m<saleId> boxes). */
export async function listSales(network: SaleNetwork, factoryId: number): Promise<SaleListing[]> {
  if (!factoryId) return [];
  const algod = getAlgod(network);
  const { boxes } = await algod.getApplicationBoxes(factoryId).max(10_000).do();

  const saleIds = boxes
    .map((b) => b.name)
    .filter((name) => name.length === 9 && name[0] === "s".charCodeAt(0))
    .map((name) => num(algosdk.decodeUint64(name.slice(1), "bigint")));

  const listings = await mapLimit(saleIds, 8, async (saleId) => {
    try {
      const [recordBox, metaBox] = await Promise.all([
        algod.getApplicationBoxByName(factoryId, prefixed("s", u64(saleId))).do(),
        algod.getApplicationBoxByName(factoryId, prefixed("m", u64(saleId))).do(),
      ]);
      return { ...decodeSaleRecord(saleId, recordBox.value), metadata: decodeMetadata(metaBox.value) };
    } catch {
      return null;
    }
  });

  return listings.filter((l): l is SaleListing => l !== null).sort((a, b) => b.saleId - a.saleId);
}

/** Factory-wide totals: number of Shuffles currently indexed and all-time ALGO volume (µALGO). */
export async function getFactoryStats(network: SaleNetwork, factoryId: number) {
  if (!factoryId) return { totalSales: 0, totalVolume: 0 };
  const app = await getAlgod(network).getApplicationByID(factoryId).do();
  const kv: Record<string, number> = {};
  for (const entry of app.params["global-state"] || []) {
    kv[new TextDecoder().decode(Buffer.from(entry.key, "base64"))] = entry.value.uint;
  }
  return { totalSales: kv.total_sales ?? 0, totalVolume: kv.total_volume ?? 0 };
}

/**
 * Look up a single sale by its app ID: read the app's sale_id and factory globals, then confirm
 * the factory's s<saleId> record points back at this app (so a look-alike app cannot pose as one).
 */
export async function getSaleByApp(
  network: SaleNetwork,
  factoryId: number,
  appId: number
): Promise<SaleListing | null> {
  const algod = getAlgod(network);
  try {
    const state = await getSaleState(network, appId);
    if (state.factory !== factoryId || !state.saleId) return null;
    const [recordBox, metaBox] = await Promise.all([
      algod.getApplicationBoxByName(factoryId, prefixed("s", u64(state.saleId))).do(),
      algod.getApplicationBoxByName(factoryId, prefixed("m", u64(state.saleId))).do(),
    ]);
    const record = decodeSaleRecord(state.saleId, recordBox.value);
    if (record.appId !== appId) return null;
    return { ...record, metadata: decodeMetadata(metaBox.value) };
  } catch {
    return null;
  }
}

export async function getSaleState(network: SaleNetwork, appId: number): Promise<SaleState> {
  const app = await getAlgod(network).getApplicationByID(appId).do();
  const kv: Record<string, number | Uint8Array> = {};
  for (const entry of app.params["global-state"] || []) {
    const key = new TextDecoder().decode(Buffer.from(entry.key, "base64"));
    kv[key] = entry.value.type === 1 ? new Uint8Array(Buffer.from(entry.value.bytes, "base64")) : entry.value.uint;
  }
  const n = (k: string) => (typeof kv[k] === "number" ? (kv[k] as number) : 0);
  const a = (k: string) => (kv[k] instanceof Uint8Array ? algosdk.encodeAddress(kv[k] as Uint8Array) : "");
  return {
    appId,
    saleId: n("sale_id"),
    factory: n("factory"),
    admin: a("admin"),
    distribution: a("distribution"),
    price: n("price"),
    startRound: n("start"),
    endRound: n("end"),
    revealFee: n("reveal_fee"),
    deliveryBudget: n("delivery_budget"),
    status: n("status"),
    total: n("total"),
    remaining: n("remaining"),
    pending: n("pending"),
    sold: n("sold"),
    proceeds: n("proceeds"),
    nextCommit: n("next_commit"),
  };
}

/** Pack a payout split into the contract's layout: 40-byte entries of (address, uint64 bps). */
export function packPayouts(payouts: PayoutSplit[]): Uint8Array {
  if (payouts.length < 1 || payouts.length > MAX_PAYOUTS) throw new Error(`Use 1 to ${MAX_PAYOUTS} payout addresses`);
  if (payouts.reduce((n, p) => n + p.bps, 0) !== BPS_TOTAL) throw new Error("Payout shares must add up to 100%");
  if (payouts.some((p) => p.bps <= 0)) throw new Error("Every payout share must be above 0%");
  return concatBytes(...payouts.map((p) => concatBytes(algosdk.decodeAddress(p.address).publicKey, u64(p.bps))));
}

/** Read a sale's payout split from its `p` box. */
export async function getPayouts(network: SaleNetwork, appId: number): Promise<PayoutSplit[]> {
  try {
    const box = await getAlgod(network).getApplicationBoxByName(appId, new TextEncoder().encode("p")).do();
    const out: PayoutSplit[] = [];
    for (let i = 0; i < box.value.length; i += 40) {
      out.push({
        address: algosdk.encodeAddress(box.value.slice(i, i + 32)),
        bps: num(algosdk.decodeUint64(box.value.slice(i + 32, i + 40), "bigint")),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function getCommit(network: SaleNetwork, appId: number, commitId: number): Promise<CommitInfo | null> {
  try {
    const box = await getAlgod(network).getApplicationBoxByName(appId, prefixed("c", u64(commitId))).do();
    const v = COMMIT_TYPE.decode(box.value) as unknown[];
    return {
      commitId,
      buyer: v[0] as string,
      targetRound: num(v[1]),
      price: num(v[2]),
      revealFee: num(v[3]),
      deposit: num(v[4]),
      boxMbr: num(v[5]),
    };
  } catch {
    return null;
  }
}

/** All pending commits of a sale (c<commitId> boxes), optionally filtered to one buyer. */
export async function listCommits(network: SaleNetwork, appId: number, buyer?: string): Promise<CommitInfo[]> {
  const { boxes } = await getAlgod(network).getApplicationBoxes(appId).max(10_000).do();
  const ids = boxes
    .map((b) => b.name)
    .filter((name) => name.length === 9 && name[0] === "c".charCodeAt(0))
    .map((name) => num(algosdk.decodeUint64(name.slice(1), "bigint")));
  const commits = await mapLimit(ids, 8, (id) => getCommit(network, appId, id));
  return commits.filter((c): c is CommitInfo => c !== null && (!buyer || c.buyer === buyer));
}

export async function fetchCollectionJson(url: string, appId?: number): Promise<CollectionJson | null> {
  if (appId) {
    try {
      const local = localStorage.getItem(`wenpad:collection:${appId}`);
      if (local) return JSON.parse(local) as CollectionJson;
    } catch {}
    try {
      const res = await fetch(`/api/wenpad-collection?appId=${appId}`);
      if (res.ok) {
        const data = (await res.json()) as CollectionJson;
        if (data) return data;
      }
    } catch {}
  }
  if (!url) return null;
  try {
    const res = await fetch(ipfsToHttp(url));
    if (!res.ok) {
      if (url.startsWith("ipfs://") || url.startsWith("http")) return { image: url };
      return null;
    }
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("image")) {
      return { image: url };
    }
    const data = await res.json();
    return {
      name: data.name,
      description: data.description,
      image: data.image || data.properties?.image || url,
      banner_image: data.banner_image,
      external_url: data.external_url,
      unit_name: data.unit_name,
      standard: data.standard,
      socials: data.socials,
      ...data,
    };
  } catch {
    if (url.startsWith("ipfs://") || url.startsWith("http")) return { image: url };
    return null;
  }
}

export interface RevealedEvent {
  commitId: number;
  buyer: string;
  assetId: number;
  inboxCost: number;
}

/** Find the Revealed event in a reveal transaction's logs. */
export function parseRevealedAsset(logs: Uint8Array[] | undefined): RevealedEvent | null {
  for (const log of logs || []) {
    if (log.length < 4 || !log.slice(0, 4).every((b, i) => b === REVEALED_SELECTOR[i])) continue;
    const v = REVEALED_TYPE.decode(log.slice(4)) as unknown[];
    return { commitId: num(v[0]), buyer: v[1] as string, assetId: num(v[2]), inboxCost: num(v[3]) };
  }
  return null;
}

/** Search the indexer for the reveal of a commit (e.g. after the keeper revealed it or a page reload). */
export async function findRevealForCommit(
  network: SaleNetwork,
  appId: number,
  commitId: number,
  minRound: number
): Promise<RevealedEvent | null> {
  try {
    const res = await fetch(
      `${INDEXER_URLS[network]}/v2/transactions?application-id=${appId}&tx-type=appl&min-round=${minRound}&limit=1000`
    );
    if (!res.ok) return null;
    const data = await res.json();
    for (const txn of data.transactions || []) {
      const logs = (txn.logs || []).map((l: string) => new Uint8Array(Buffer.from(l, "base64")));
      const event = parseRevealedAsset(logs);
      if (event && event.commitId === commitId) return event;
    }
  } catch {
    // indexer unavailable
  }
  return null;
}

/** Whether `account` holds at least one unit of `assetId` (direct delivery) as opposed to its ARC-59 inbox. */
export async function holdsAsset(network: SaleNetwork, account: string, assetId: number): Promise<boolean> {
  try {
    const info = await getAlgod(network).accountAssetInformation(account, assetId).do();
    return Number(info["asset-holding"]?.amount || 0) > 0;
  } catch {
    return false;
  }
}

// ─── Cost estimates ──────────────────────────────────────────────────────────

/** Factory MBR for createSale. Any overpayment is refunded by the contract. */
export function estimateCreateSaleMbr(meta: SaleMetadata): number {
  const metaLen = SALE_METADATA_TYPE.encode([meta.name, meta.unitName, meta.standard, meta.metadataUrl]).length;
  return (
    CHILD_APP_MBR +
    boxMbr(9, 168) + // s<saleId> SaleRecord
    boxMbr(9, metaLen) + // m<saleId> SaleMetadata
    boxMbr(1 + 32 + 8, 8) + // c<admin><saleId>
    CHILD_SEED
  );
}

export function itemPagesFor(count: number) {
  return Math.ceil(count / PAGE_ITEMS);
}

/** What a buyer pays per mint, broken into the line items the contract enforces. */
export function buyerLineItems(state: Pick<SaleState, "price" | "revealFee" | "deliveryBudget">) {
  return {
    price: state.price,
    revealFee: state.revealFee,
    storageDeposit: COMMIT_BOX_MBR,
    deliveryDeposit: state.deliveryBudget,
    total: state.price + state.revealFee + COMMIT_BOX_MBR + state.deliveryBudget,
    refundable: COMMIT_BOX_MBR + state.deliveryBudget,
  };
}

// ─── Group building ──────────────────────────────────────────────────────────

const emptySigner = algosdk.makeEmptyTransactionSigner();

const cloneTxn = (t: algosdk.Transaction) => {
  const c = algosdk.decodeUnsignedTransaction(algosdk.encodeUnsignedTransaction(t));
  c.group = undefined;
  return c;
};

const countInner = (r: any): number =>
  (r?.innerTxns || []).reduce((n: number, inner: any) => n + 1 + countInner(inner), 0);

function opUpTxn(sender: string, appId: number, sp: algosdk.SuggestedParams, i: number) {
  return algosdk.makeApplicationNoOpTxnFromObject({
    from: sender,
    appIndex: appId,
    appArgs: [M.opUp.getSelector()],
    note: new TextEncoder().encode(`opup-${i}`),
    suggestedParams: sp,
  });
}

/** Failures fixed by adding opUp calls: out of opcode budget, or out of reference slots */
const NEEDS_MORE_APP_CALLS = /budget|reference limit/i;

/**
 * Make a group ready to sign:
 *  1. fill in every account/asset/app/box reference via simulate (algokit populateAppCallResources)
 *  2. add opUp calls (at the front) if the group runs out of opcode budget or reference slots
 *     (an ARC-59 delivery touches more accounts/assets/boxes than one app call can carry)
 *  3. set each app call's fee to exactly cover its own inner transactions (inner fees are 0)
 */
export async function finalizeGroup(
  algod: algosdk.Algodv2,
  txns: algosdk.Transaction[],
  opUp?: { appId: number; sender: string }
): Promise<algosdk.Transaction[]> {
  const sp = await algod.getTransactionParams().do();
  const minFee = Number(sp.minFee ?? 1000);
  const isAppCall = (t: algosdk.Transaction) => t.type === algosdk.TransactionType.appl;

  let opUps = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    const base = [
      ...Array.from({ length: opUps }, (_, i) => opUpTxn(opUp!.sender, opUp!.appId, sp, i)),
      ...txns.map(cloneTxn),
    ];
    // Generous temporary fees so simulate never fails on fees
    for (const t of base) t.fee = isAppCall(t) ? minFee * 30 : minFee;

    const atc = new algosdk.AtomicTransactionComposer();
    base.forEach((txn) => atc.addTransaction({ txn, signer: emptySigner }));

    let populated: algosdk.AtomicTransactionComposer;
    try {
      populated = await populateAppCallResources(atc, algod);
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (opUp && NEEDS_MORE_APP_CALLS.test(msg) && attempt < 5) {
        opUps++;
        continue;
      }
      throw new Error(simulateErrorMessage(msg));
    }

    const built = populated.buildGroup().map((t) => {
      t.txn.group = undefined;
      return t.txn;
    });

    const simAtc = new algosdk.AtomicTransactionComposer();
    built.forEach((txn) => simAtc.addTransaction({ txn, signer: emptySigner }));
    const { simulateResponse } = await simAtc.simulate(
      algod,
      new algosdk.modelsv2.SimulateRequest({
        txnGroups: [],
        allowEmptySignatures: true,
        allowUnnamedResources: true,
        // Rekeyed senders sign with their auth address; without this simulate rejects them
        fixSigners: true,
      })
    );
    const group = simulateResponse.txnGroups[0];
    if (group.failureMessage) {
      if (opUp && NEEDS_MORE_APP_CALLS.test(group.failureMessage) && attempt < 5) {
        opUps++;
        continue;
      }
      throw new Error(simulateErrorMessage(group.failureMessage));
    }

    built.forEach((t, i) => {
      t.fee = isAppCall(t) ? minFee * (1 + countInner(group.txnResults[i].txnResult)) : minFee;
      // simulate() ran buildGroup() on these same objects; clear that group before recomputing
      t.group = undefined;
    });
    algosdk.assignGroupID(built);
    return built;
  }
  throw new Error("Could not fit the transaction group within the opcode budget");
}

/** Turn raw simulate/logic errors into something a person can act on. */
function simulateErrorMessage(msg: string) {
  if (/overspend|below min/i.test(msg)) return "Insufficient ALGO balance for this transaction.";
  if (/rejected by logic|assert failed|logic eval error/i.test(msg)) {
    return `The contract rejected this transaction: ${msg.slice(0, 240)}`;
  }
  return msg;
}

/** Encode one ABI method call (plus any transaction args) into transactions. */
function methodCall(
  appId: number,
  m: algosdk.ABIMethod,
  sender: string,
  sp: algosdk.SuggestedParams,
  args: algosdk.ABIArgument[] = []
): algosdk.Transaction[] {
  const atc = new algosdk.AtomicTransactionComposer();
  atc.addMethodCall({
    appID: appId,
    method: m,
    methodArgs: args,
    sender,
    suggestedParams: sp,
    signer: emptySigner,
  });
  return atc.buildGroup().map((t) => {
    t.txn.group = undefined;
    return t.txn;
  });
}

const payTxn = (from: string, to: string, amount: number, sp: algosdk.SuggestedParams) =>
  algosdk.makePaymentTxnWithSuggestedParamsFromObject({ from, to, amount, suggestedParams: sp });

// ─── Builders: creator ───────────────────────────────────────────────────────

export interface CreateSaleParams {
  /** Manager: controls the sale once live (must differ from the distribution wallet) */
  admin: string;
  payouts: PayoutSplit[];
  price: number;
  startRound: number;
  endRound: number;
  revealFee: number;
  deliveryBudget: number;
  metadata: SaleMetadata;
}

/** createSale is sent by the distribution wallet: the connected wallet holding the collection. */
export async function buildCreateSale(
  network: SaleNetwork,
  factoryId: number,
  distribution: string,
  p: CreateSaleParams
) {
  const algod = getAlgod(network);
  const sp = await algod.getTransactionParams().do();
  const mbrPay = payTxn(distribution, algosdk.getApplicationAddress(factoryId), estimateCreateSaleMbr(p.metadata), sp);
  const txns = methodCall(factoryId, M.createSale, distribution, sp, [
    { txn: mbrPay, signer: emptySigner },
    p.admin,
    packPayouts(p.payouts),
    p.price,
    p.startRound,
    p.endRound,
    p.revealFee,
    p.deliveryBudget,
    p.metadata.name,
    p.metadata.unitName,
    p.metadata.standard,
    p.metadata.metadataUrl,
  ]);
  return finalizeGroup(algod, txns);
}

/**
 * Whether an error is a box-reference race: createSale's boxes are keyed by the next sale ID,
 * so if another sale is created between building and sending, the references go stale.
 * Rebuilding the group fixes it.
 */
export const isStaleBoxReference = (err: unknown) => /invalid Box reference/i.test(String((err as any)?.message || err));

/** Read the new sale's ID (ABI return) and app ID (first inner txn) from the confirmed createSale call. */
export function parseCreateSaleResult(confirmation: any): { saleId: number; appId: number } {
  const logs: Uint8Array[] = confirmation.logs || [];
  const ret = logs[logs.length - 1];
  const saleId = num(algosdk.decodeUint64(ret.slice(4), "bigint"));
  const appId = Number(confirmation["inner-txns"]?.[0]?.["application-index"] || 0);
  if (!appId) throw new Error("Sale app ID not found in confirmation");
  return { saleId, appId };
}

/** Max items in one addItems group: 8 [pay, addItems] pairs fill the 16-transaction limit */
export const MAX_ITEMS_PER_GROUP = MAX_ITEMS_PER_CALL * 8;

/**
 * One group of [pay, addItems] pairs appending up to MAX_ITEMS_PER_GROUP `assetIds` to a sale
 * that currently holds `existingCount` items. Build the next group only after this one is
 * confirmed: simulation (resource population) depends on the on-chain item count.
 * Signed by the distribution wallet (during setup) or the admin.
 */
export async function buildAddItemsGroup(
  network: SaleNetwork,
  sender: string,
  appId: number,
  assetIds: number[],
  existingCount: number
): Promise<algosdk.Transaction[]> {
  if (assetIds.length > MAX_ITEMS_PER_GROUP) throw new Error(`At most ${MAX_ITEMS_PER_GROUP} items per group`);
  const algod = getAlgod(network);
  const sp = await algod.getTransactionParams().do();
  const appAddr = algosdk.getApplicationAddress(appId);

  const txns: algosdk.Transaction[] = [];
  let count = existingCount;
  for (let j = 0; j < assetIds.length; j += MAX_ITEMS_PER_CALL) {
    const chunk = assetIds.slice(j, j + MAX_ITEMS_PER_CALL);
    const newPages = itemPagesFor(count + chunk.length) - itemPagesFor(count);
    const pay = payTxn(sender, appAddr, newPages * ITEM_PAGE_MBR, sp);
    // Packed big-endian uint64s, the same layout the contract stores in each item page
    const packed = concatBytes(...chunk.map((id) => u64(id)));
    txns.push(...methodCall(appId, M.addItems, sender, sp, [{ txn: pay, signer: emptySigner }, packed]));
    count += chunk.length;
  }
  return finalizeGroup(algod, txns);
}

/**
 * Go live: signed by the distribution wallet in one prompt.
 * [register(), pay 0 to self with rekeyTo = sale app]. register() verifies the rekey that follows it.
 */
export async function buildRegister(network: SaleNetwork, distribution: string, appId: number) {
  const algod = getAlgod(network);
  const sp = await algod.getTransactionParams().do();
  const rekey = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: distribution,
    to: distribution,
    amount: 0,
    rekeyTo: algosdk.getApplicationAddress(appId),
    suggestedParams: sp,
  });
  // opUp calls are inserted at the front, before the rekey, so the distribution key can still sign them
  return finalizeGroup(algod, [...methodCall(appId, M.register, distribution, sp), rekey], {
    appId,
    sender: distribution,
  });
}

type AdminAction = "pause" | "unpause" | "release" | "withdrawProceeds";

export async function buildSaleAction(network: SaleNetwork, sender: string, appId: number, action: AdminAction) {
  const algod = getAlgod(network);
  const sp = await algod.getTransactionParams().do();
  return finalizeGroup(algod, methodCall(appId, M[action], sender, sp), { appId, sender });
}

export async function buildSetPrice(network: SaleNetwork, admin: string, appId: number, price: number) {
  const algod = getAlgod(network);
  const sp = await algod.getTransactionParams().do();
  return finalizeGroup(algod, methodCall(appId, M.setPrice, admin, sp, [price]));
}

export async function buildSetEndRound(network: SaleNetwork, admin: string, appId: number, endRound: number) {
  const algod = getAlgod(network);
  const sp = await algod.getTransactionParams().do();
  return finalizeGroup(algod, methodCall(appId, M.setEndRound, admin, sp, [endRound]));
}

/** Free all leftover item pages after release (needed before deleteSale). */
export async function buildDeleteItemPages(network: SaleNetwork, sender: string, appId: number) {
  const algod = getAlgod(network);
  const sp = await algod.getTransactionParams().do();
  const { boxes } = await algod.getApplicationBoxes(appId).max(10_000).do();
  const pages = boxes
    .map((b) => b.name)
    .filter((name) => name.length === 9 && name[0] === "i".charCodeAt(0))
    .map((name) => num(algosdk.decodeUint64(name.slice(1), "bigint")));

  const groups: algosdk.Transaction[][] = [];
  for (let i = 0; i < pages.length; i += 16) {
    const txns = pages
      .slice(i, i + 16)
      .flatMap((page) => methodCall(appId, M.deleteItemPage, sender, sp, [page]));
    groups.push(await finalizeGroup(algod, txns));
  }
  return groups;
}

export async function buildDeleteSale(network: SaleNetwork, factoryId: number, admin: string, saleId: number) {
  const algod = getAlgod(network);
  const sp = await algod.getTransactionParams().do();
  return finalizeGroup(algod, methodCall(factoryId, M.deleteSale, admin, sp, [saleId]));
}

export async function buildUpdateMetadata(
  network: SaleNetwork,
  factoryId: number,
  admin: string,
  saleId: number,
  meta: SaleMetadata
) {
  const algod = getAlgod(network);
  const sp = await algod.getTransactionParams().do();
  // Cover a worst-case increase; the contract refunds any decrease via an inner payment
  const pay = payTxn(admin, algosdk.getApplicationAddress(factoryId), 400 * 400, sp);
  return finalizeGroup(
    algod,
    methodCall(factoryId, M.updateMetadata, admin, sp, [
      { txn: pay, signer: emptySigner },
      saleId,
      meta.name,
      meta.unitName,
      meta.standard,
      meta.metadataUrl,
    ])
  );
}

// ─── Builders: buyer / keeper ────────────────────────────────────────────────

export async function buildCommit(network: SaleNetwork, buyer: string, state: SaleState) {
  const algod = getAlgod(network);
  const sp = await algod.getTransactionParams().do();
  const pay = payTxn(buyer, algosdk.getApplicationAddress(state.appId), buyerLineItems(state).total, sp);
  return finalizeGroup(algod, methodCall(state.appId, M.commit, buyer, sp, [{ txn: pay, signer: emptySigner }]));
}

/** commitId (ABI return) and target round from a confirmed commit call. */
export function parseCommitResult(confirmation: any): { commitId: number; targetRound: number } {
  const logs: Uint8Array[] = confirmation.logs || [];
  const ret = logs[logs.length - 1];
  return {
    commitId: num(algosdk.decodeUint64(ret.slice(4), "bigint")),
    targetRound: Number(confirmation["confirmed-round"]) + 1,
  };
}

/**
 * Validity window for reveal transactions. The AVM only lets a transaction read block seeds in
 * (lastValid - 1002, firstValid), so the default 1000-round window would leave a single readable
 * round. 10 rounds (~28s, enough for a wallet prompt) keeps ~990 rounds of history readable.
 */
const REVEAL_VALIDITY_ROUNDS = 10;

export async function buildReveal(network: SaleNetwork, caller: string, appId: number, commitId: number) {
  const algod = getAlgod(network);
  const sp = await algod.getTransactionParams().do();
  sp.lastRound = sp.firstRound + REVEAL_VALIDITY_ROUNDS;
  return finalizeGroup(algod, methodCall(appId, M.reveal, caller, sp, [commitId]), { appId, sender: caller });
}

/**
 * Claim an NFT from the buyer's ARC-59 inbox: [opt-in (if needed), arc59_claim(asset)].
 * The router sends the NFT plus any leftover inbox ALGO (the rest of the delivery deposit).
 */
export async function buildArc59Claim(network: SaleNetwork, receiver: string, assetId: number) {
  const algod = getAlgod(network);
  const sp = await algod.getTransactionParams().do();
  const txns: algosdk.Transaction[] = [];
  let optedIn = false;
  try {
    await algod.accountAssetInformation(receiver, assetId).do();
    optedIn = true;
  } catch {
    // not opted in yet
  }
  if (!optedIn) {
    txns.push(
      algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        from: receiver,
        to: receiver,
        amount: 0,
        assetIndex: assetId,
        suggestedParams: sp,
      })
    );
  }
  txns.push(...methodCall(ARC59_ROUTER_IDS[network], method("arc59_claim(uint64)void"), receiver, sp, [assetId]));
  return finalizeGroup(algod, txns);
}

export async function buildCancelExpired(network: SaleNetwork, caller: string, appId: number, commitId: number) {
  const algod = getAlgod(network);
  const sp = await algod.getTransactionParams().do();
  return finalizeGroup(algod, methodCall(appId, M.cancelExpired, caller, sp, [commitId]));
}

/** Wait until the chain is past `round` (the reveal needs that round's block seed). */
export async function waitForRound(algod: algosdk.Algodv2, round: number, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let status = await algod.status().do();
  while (Number(status["last-round"]) <= round) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for round ${round + 1}`);
    status = await algod.statusAfterBlock(Number(status["last-round"])).do();
  }
  return Number(status["last-round"]);
}

export async function getCurrentRound(network: SaleNetwork) {
  const status = await getAlgod(network).status().do();
  return Number(status["last-round"]);
}

export const roundToDate = (round: number, currentRound: number) =>
  new Date(Date.now() + (round - currentRound) * AVG_ROUND_SECONDS * 1000);

export const dateToRound = (date: Date, currentRound: number) =>
  currentRound + Math.ceil((date.getTime() - Date.now()) / 1000 / AVG_ROUND_SECONDS);
