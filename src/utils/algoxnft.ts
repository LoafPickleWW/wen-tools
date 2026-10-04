/**
 * Recover NFTs stuck in old AlgoxNFT "Buy It Now" listings.
 *
 * Each listing is a stateless escrow (logic sig) holding one NFT. Its
 * "close early" branch lets the seller cancel with a 3-transaction group:
 *   0. seller -> seller, 0 ALGO          (signed by the seller: permission)
 *   1. escrow -> seller, 0 of the asset, asset close-to seller  (logic sig)
 *   2. escrow -> admin,  0 ALGO, close-to admin                 (logic sig)
 * Reference implementation: https://gist.github.com/algoxnft-open-source
 * (close_buy_now.ts and buy_it_now_stateless_contract.py).
 *
 * Discovery is fully on-chain and verified:
 *   - escrows that received the user's NFTs and still hold them
 *   - the escrow's program is read from its own logic-sig opt-in
 *   - the program must hash to the escrow address, close the NFT to this
 *     user, and pay leftovers to the AlgoxNFT admin (algoxnft.algo)
 *   - every close group is simulated before the user is asked to sign
 */
import algosdk, { Transaction } from "algosdk";

/** algoxnft.algo, the admin address baked into AlgoxNFT escrow contracts. */
export const ALGOXNFT_ADMIN = "XNFT36FUCFRR6CK675FW4BEBCCCOJ4HOSMGCN6J2W6ZMB34KM2ENTNQCP4";

/** Round the algoxnft.algo admin account was created; nothing older is relevant. */
const ALGOXNFT_MIN_ROUND = 16_863_221;
/**
 * Exact amounts AlgoxNFT used to fund listing escrows in the creation group
 * (measured across real mainnet escrows). Exact-match filtering is far more
 * selective than a range for wallets with heavy marketplace activity.
 */
const ESCROW_FUNDING_AMOUNTS = [10_000, 250_000, 500_000];
/** Upper bound on pages of funding payments scanned, to keep huge wallets bounded. */
const MAX_HISTORY_PAGES = 15;
/** Upper bound on escrows checked, to stay light on public nodes. */
const MAX_CANDIDATES = 300;
/** Escrows opt in to a single NFT; anything holding more is not one. */
const MAX_ESCROW_ASSETS = 4;
/** Rounds after funding in which the escrow's own opt-in is looked for. */
const ESCROW_OPTIN_WINDOW = 100;

export interface AlgoxListing {
  escrow: string;
  assetId: number;
  program: Uint8Array;
  /** The user has since opted out of the asset and must opt back in first */
  needsOptIn: boolean;
}

/* ------------------------------------------------------------------------- */
/* TEAL bytecode inspection                                                  */
/* ------------------------------------------------------------------------- */

const readUvarint = (b: Uint8Array, i: number): [number, number] => {
  let x = 0;
  let shift = 0;
  let byte: number;
  do {
    byte = b[i++];
    x += (byte & 0x7f) * 2 ** shift;
    shift += 7;
  } while (byte & 0x80);
  return [x, i];
};

/** Reads the leading intcblock / bytecblock constant pools. */
function byteConstants(prog: Uint8Array): Uint8Array[] {
  let [, i] = readUvarint(prog, 0); // version
  const bytes: Uint8Array[] = [];
  for (let k = 0; k < 2; k++) {
    if (prog[i] === 0x20) {
      let n: number;
      [n, i] = readUvarint(prog, i + 1);
      for (let j = 0; j < n; j++) [, i] = readUvarint(prog, i);
    } else if (prog[i] === 0x26) {
      let n: number;
      [n, i] = readUvarint(prog, i + 1);
      for (let j = 0; j < n; j++) {
        let len: number;
        [len, i] = readUvarint(prog, i);
        bytes.push(prog.slice(i, i + len));
        i += len;
      }
    }
  }
  return bytes;
}

/**
 * Addresses the program compares against `gtxn <group> <field>` with `==`.
 * Handles bytec_0..3, `bytec i` and inline `pushbytes`.
 */
function addressesComparedTo(prog: Uint8Array, group: number, field: number): string[] {
  const consts = byteConstants(prog);
  const out = new Set<string>();
  for (let i = 0; i < prog.length - 3; i++) {
    if (prog[i] !== 0x33 || prog[i + 1] !== group || prog[i + 2] !== field) continue;
    let j = i + 3;
    let val: Uint8Array | undefined;
    const op = prog[j];
    if (op >= 0x28 && op <= 0x2b) {
      val = consts[op - 0x28];
      j += 1;
    } else if (op === 0x27) {
      val = consts[prog[j + 1]];
      j += 2;
    } else if (op === 0x80) {
      let len: number;
      [len, j] = readUvarint(prog, j + 1);
      val = prog.slice(j, j + len);
      j += len;
    }
    if (val && val.length === 32 && prog[j] === 0x12) out.add(algosdk.encodeAddress(val));
  }
  return [...out];
}

const TXN_FIELD_CLOSE_REMAINDER_TO = 9;
const TXN_FIELD_ASSET_CLOSE_TO = 21;

/** True if this program is an AlgoxNFT escrow the given seller can close. */
export function isClosableAlgoxEscrow(program: Uint8Array, escrow: string, seller: string): boolean {
  // The program must actually be this escrow's program
  if (new algosdk.LogicSigAccount(program).address() !== escrow) return false;
  const admins = addressesComparedTo(program, 2, TXN_FIELD_CLOSE_REMAINDER_TO);
  const sellers = addressesComparedTo(program, 1, TXN_FIELD_ASSET_CLOSE_TO);
  return admins.includes(ALGOXNFT_ADMIN) && sellers.includes(seller);
}

/* ------------------------------------------------------------------------- */
/* Discovery                                                                 */
/* ------------------------------------------------------------------------- */

export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Public nodes rate-limit bursts. A throttled lookup must be retried, never
 * read as "not found", or listings silently vanish from one load to the next.
 */
const MAINNET_FALLBACK_INDEXER = "https://mainnet-idx.4160.nodely.dev";

const statusOf = (e: any): number | undefined => e?.status ?? e?.response?.status;
const isNotFound = (e: any) => statusOf(e) === 404;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (isNotFound(e) || i >= attempts - 1) throw e;
      await sleep(350 * 2 ** i + Math.random() * 200);
    }
  }
}

/** The node's own reason for rejecting a submission (e.g. "overspend", "txn dead"). */
export const nodeErrorMessage = (e: any): string => {
  if (e?.response?.body?.message) return String(e.response.body.message);
  if (e?.response?.body instanceof Uint8Array) {
    try {
      const text = new TextDecoder().decode(e.response.body);
      const parsed = JSON.parse(text);
      if (parsed.message) return String(parsed.message);
    } catch {}
  }
  if (e?.response?.text) {
    try {
      const parsed = JSON.parse(e.response.text);
      if (parsed.message) return String(parsed.message);
    } catch {}
    return String(e.response.text).trim();
  }
  const raw = e?.message ?? String(e);
  const colonIdx = raw.indexOf("): ");
  if (colonIdx !== -1) {
    return raw.slice(colonIdx + 3).trim();
  }
  return raw;
};

/** Indexer GET with retries and automatic fallback to secondary indexer if primary returns 500/errors. */
async function getJson(url: string, fallbackBase?: string): Promise<any> {
  try {
    return await withRetry(async () => {
      const r = await fetch(url);
      if (!r.ok) throw Object.assign(new Error(`indexer ${r.status}`), { status: r.status === 404 ? 599 : r.status });
      return r.json();
    });
  } catch (e) {
    if (fallbackBase) {
      try {
        const altUrl = url.replace(/https:\/\/[^/]+/, fallbackBase);
        const r = await fetch(altUrl);
        if (r.ok) return r.json();
      } catch {}
    }
    throw e;
  }
}

/** Holding amount, or null only when the account is genuinely not opted in. */
async function holdsAsset(algod: algosdk.Algodv2, address: string, assetId: number): Promise<number | null> {
  try {
    const info: any = await withRetry(() => algod.accountAssetInformation(address, assetId).do());
    return Number(info["asset-holding"]?.amount ?? 0);
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

/**
 * Finds the user's still-open AlgoxNFT Buy Now listings.
 *
 * Listing creation funded the escrow with an ALGO payment from the seller,
 * inside an atomic group, of one of a few exact amounts. The indexer filters
 * payments by amount server side, so this stays fast even for wallets with
 * huge histories. Each candidate escrow is then checked directly for NFTs it
 * still holds.
 */
export async function findAlgoxListings(
  seller: string,
  algod: algosdk.Algodv2,
  indexerUrl: string
): Promise<AlgoxListing[]> {
  const fallbackBase = indexerUrl.includes("algonode") ? MAINNET_FALLBACK_INDEXER : undefined;
  // escrow -> round it was funded (its creation group)
  const escrows = new Map<string, number>();
  const scan = async (amount: number) => {
    let next = "";
    for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
      const url =
        `${indexerUrl}/v2/transactions?address=${seller}&address-role=sender&tx-type=pay` +
        `&currency-greater-than=${amount - 1}&currency-less-than=${amount + 1}` +
        `&min-round=${ALGOXNFT_MIN_ROUND}&limit=1000` +
        (next ? `&next=${next}` : "");
      const res = await getJson(url, fallbackBase);
      for (const t of res.transactions ?? []) {
        const receiver = t["payment-transaction"]?.receiver;
        if (t.group && receiver && receiver !== seller && !escrows.has(receiver)) escrows.set(receiver, Number(t["confirmed-round"]));
      }
      next = res["next-token"];
      if (!next || !(res.transactions ?? []).length) break;
    }
  };

  // Run scans sequentially to avoid triggering indexer rate-limits / 500 timeouts
  for (const amount of ESCROW_FUNDING_AMOUNTS) {
    try {
      await scan(amount);
    } catch (e) {
      console.warn(`AlgoxNFT funding scan for amount ${amount} failed:`, e);
    }
  }
  const candidates = [...escrows].slice(0, MAX_CANDIDATES);

  const perEscrow = await mapLimit(candidates, 4, async ([escrow, fundedRound]) => {
    try {
      let held: number[] = [];
      try {
        const info: any = await withRetry(() => algod.accountInformation(escrow).do());
        const optedIn: any[] = info.assets ?? [];
        if (optedIn.length > MAX_ESCROW_ASSETS) return [];
        held = optedIn.filter((a: any) => Number(a.amount) >= 1).map((a: any) => Number(a["asset-id"]));
      } catch (e) {
        if (isNotFound(e)) return [];
        throw e;
      }
      if (!held.length) return [];

      const res = await getJson(
        `${indexerUrl}/v2/accounts/${escrow}/transactions?sig-type=lsig&limit=1` +
          `&min-round=${fundedRound}&max-round=${fundedRound + ESCROW_OPTIN_WINDOW}`,
        fallbackBase
      ).catch(() => ({ transactions: [] }));
      const logic: string | undefined = res.transactions?.[0]?.signature?.logicsig?.logic;
      if (!logic) return [];
      const program = new Uint8Array(Buffer.from(logic, "base64"));
      if (!isClosableAlgoxEscrow(program, escrow, seller)) return [];

      return Promise.all(
        held.map(async (assetId) => ({
          escrow,
          assetId,
          program,
          needsOptIn: (await holdsAsset(algod, seller, assetId)) === null,
        }))
      );
    } catch (e) {
      console.warn(`AlgoxNFT check for escrow ${escrow} failed:`, e);
      return [];
    }
  });

  return perEscrow.flat();
}

/* ------------------------------------------------------------------------- */
/* Transactions                                                              */
/* ------------------------------------------------------------------------- */

export interface AlgoxClosePlan {
  listing: AlgoxListing;
  optIn: Transaction | null;
  /** [permission, asset close, algo close] */
  group: Transaction[];
}

export function buildAlgoxClosePlan(
  listing: AlgoxListing,
  seller: string,
  params: algosdk.SuggestedParams
): AlgoxClosePlan {
  const sp = { ...params, flatFee: true, fee: 1000 };
  const permission = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: seller,
    to: seller,
    amount: 0,
    suggestedParams: sp,
  });
  const assetClose = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    from: listing.escrow,
    to: seller,
    closeRemainderTo: seller,
    amount: 0,
    assetIndex: listing.assetId,
    suggestedParams: sp,
  });
  const algoClose = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: listing.escrow,
    to: ALGOXNFT_ADMIN,
    closeRemainderTo: ALGOXNFT_ADMIN,
    amount: 0,
    suggestedParams: sp,
  });
  const group = algosdk.assignGroupID([permission, assetClose, algoClose]);
  const optIn = listing.needsOptIn
    ? algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        from: seller,
        to: seller,
        amount: 0,
        assetIndex: listing.assetId,
        suggestedParams: sp,
      })
    : null;
  return { listing, optIn, group };
}

const lsigSign = (txn: Transaction, program: Uint8Array) =>
  algosdk.signLogicSigTransactionObject(txn, new algosdk.LogicSigAccount(program)).blob;

export type AlgoxSimulation =
  | { status: "ready" }
  /** The escrow's contract will not accept this close (e.g. an auction escrow) */
  | { status: "rejected"; message: string }
  /** The contract accepts it, but the user's account must be fixed first */
  | { status: "account"; message: string };

/**
 * Dry-runs the close group against the current ledger without signatures.
 *
 * Public nodes simulate one group per request, so the opt-in can't be
 * replayed first. That's fine: logic sigs are verified for the whole group
 * before any balance effects apply, so if the failure is not a logic
 * rejection, the escrow contract has approved the close and what remains is
 * account state (the pending opt-in, or a low ALGO balance).
 */
export async function simulateAlgoxClose(algod: algosdk.Algodv2, plan: AlgoxClosePlan): Promise<AlgoxSimulation> {
  const unsigned = (t: Transaction) => algosdk.decodeObj(algosdk.encodeUnsignedSimulateTransaction(t)) as any;
  const lsig = (t: Transaction) => algosdk.decodeObj(lsigSign(t, plan.listing.program)) as any;
  let failure: string | undefined;
  try {
    const res: any = await algod
      .simulateTransactions(
        new algosdk.modelsv2.SimulateRequest({
          txnGroups: [
            new algosdk.modelsv2.SimulateRequestTransactionGroup({
              txns: [unsigned(plan.group[0]), lsig(plan.group[1]), lsig(plan.group[2])],
            }),
          ],
          allowEmptySignatures: true,
          // Rekeyed accounts sign with their auth address, not their own key
          fixSigners: true,
        })
      )
      .do();
    failure = res.txnGroups?.[0]?.failureMessage;
  } catch (e: any) {
    return { status: "account", message: e?.message ?? "simulation failed" };
  }

  if (!failure) return { status: "ready" };
  if (/rejected by logic/i.test(failure)) return { status: "rejected", message: failure };
  if (/below min/i.test(failure)) {
    return { status: "account", message: "Not enough ALGO to cover your minimum balance and fees. Top up and try again." };
  }
  // Expected while not opted in: the opt-in sent first resolves it
  if (plan.optIn) return { status: "ready" };
  return { status: "account", message: failure };
}

/**
 * A close plan as claim steps: the opt-in (if needed) goes first on its own,
 * since the escrow contract only accepts its exact 3-transaction group. The
 * escrow transactions are signed here by the logic sig; the user signs gtxn 0.
 */
export function algoxCloseJob(plan: AlgoxClosePlan): ClaimJob {
  const steps: ClaimStep[] = [];
  if (plan.optIn) steps.push({ txns: [plan.optIn], userSigns: [0] });
  steps.push({
    txns: plan.group,
    userSigns: [0],
    presigned: [undefined, lsigSign(plan.group[1], plan.listing.program), lsigSign(plan.group[2], plan.listing.program)],
  });
  return { assetId: plan.listing.assetId, steps };
}

/* ------------------------------------------------------------------------- */
/* Batched claims: every group signed in one wallet prompt                   */
/* ------------------------------------------------------------------------- */

/** One transaction group, submitted atomically. */
export interface ClaimStep {
  txns: Transaction[];
  /** Indexes in `txns` the user signs */
  userSigns: number[];
  /** Blobs already signed by someone else (e.g. a logic sig), by index */
  presigned?: (Uint8Array | undefined)[];
}

/** Everything needed to claim one asset; steps are confirmed in order. */
export interface ClaimJob {
  assetId: number;
  steps: ClaimStep[];
}

export interface SignedClaimJob {
  assetId: number;
  steps: Uint8Array[][];
}

/** Signs many groups at once, e.g. use-wallet's `signTransactions`. */
export type BatchSigner = (groups: Transaction[][], indexesToSign: number[]) => Promise<(Uint8Array | null)[]>;

export const countClaimTxns = (jobs: ClaimJob[]) =>
  jobs.reduce((n, j) => n + j.steps.reduce((m, s) => m + s.txns.length, 0), 0);

/**
 * Signs every step of every job in a single request, so the user approves
 * all selected claims with one signature in their wallet.
 */
export async function signClaimJobs(
  jobs: ClaimJob[],
  sign: { signer: BatchSigner } | { sk: Uint8Array }
): Promise<SignedClaimJob[]> {
  const steps = jobs.flatMap((j) => j.steps);
  // Wallets (Pera) merge ungrouped transactions in a multi-group request into
  // one group, so each step that has no group yet gets its own, even if single.
  for (const s of steps) {
    if (s.txns.every((t) => !t.group || t.group.every((b) => b === 0))) algosdk.assignGroupID(s.txns);
  }
  let userBlobs: (Uint8Array | null)[];
  if ("sk" in sign) {
    userBlobs = steps.flatMap((s) => s.txns.map((t, i) => (s.userSigns.includes(i) ? t.signTxn(sign.sk) : null)));
  } else {
    const indexes: number[] = [];
    let offset = 0;
    for (const s of steps) {
      s.userSigns.forEach((i) => indexes.push(offset + i));
      offset += s.txns.length;
    }
    userBlobs = await sign.signer(
      steps.map((s) => s.txns),
      indexes
    );
    if (userBlobs.length !== offset) throw new Error("the wallet did not return every transaction");
  }

  let cursor = 0;
  return jobs.map((job) => ({
    assetId: job.assetId,
    steps: job.steps.map((s) =>
      s.txns.map((_, i) => {
        const blob = s.userSigns.includes(i) ? userBlobs[cursor] : s.presigned?.[i];
        cursor++;
        if (!blob) throw new Error(`transaction for asset ${job.assetId} was not signed`);
        return blob;
      })
    ),
  }));
}

/**
 * Submits signed jobs a few at a time. A failed job doesn't stop the others;
 * a failed step stops the rest of its own job (e.g. a close without opt-in).
 */
export async function submitClaimJobs(
  algod: algosdk.Algodv2,
  jobs: SignedClaimJob[],
  onProgress?: (done: number, total: number, assetId: number, ok: boolean, error?: string) => void
): Promise<{ assetId: number; txId?: string; error?: string }[]> {
  let done = 0;
  return mapLimit(jobs, 4, async (job) => {
    try {
      let txId = "";
      for (const blobs of job.steps) {
        ({ txId } = await algod.sendRawTransaction(blobs).do());
        await algosdk.waitForConfirmation(algod, txId, 6);
      }
      onProgress?.(++done, jobs.length, job.assetId, true);
      return { assetId: job.assetId, txId };
    } catch (e: any) {
      const error = nodeErrorMessage(e);
      console.error(`Claim ${job.assetId} failed:`, error);
      onProgress?.(++done, jobs.length, job.assetId, false, error);
      return { assetId: job.assetId, error };
    }
  });
}
