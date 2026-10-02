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

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
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

async function holdsAsset(algod: algosdk.Algodv2, address: string, assetId: number): Promise<number | null> {
  try {
    const info: any = await algod.accountAssetInformation(address, assetId).do();
    return Number(info["asset-holding"]?.amount ?? 0);
  } catch {
    return null; // not opted in (404) or lookup failed
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
  const escrows = new Set<string>();
  const scan = async (amount: number) => {
    let next = "";
    for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
      const url =
        `${indexerUrl}/v2/transactions?address=${seller}&address-role=sender&tx-type=pay` +
        `&currency-greater-than=${amount - 1}&currency-less-than=${amount + 1}` +
        `&min-round=${ALGOXNFT_MIN_ROUND}&limit=1000` +
        (next ? `&next=${next}` : "");
      const res = await fetch(url).then((r) => r.json());
      for (const t of res.transactions ?? []) {
        const receiver = t["payment-transaction"]?.receiver;
        if (t.group && receiver && receiver !== seller) escrows.add(receiver);
      }
      next = res["next-token"];
      if (!next || !(res.transactions ?? []).length) break;
    }
  };
  await Promise.all(ESCROW_FUNDING_AMOUNTS.map(scan));
  const candidates = [...escrows].slice(0, MAX_CANDIDATES);

  const perEscrow = await mapLimit(candidates, 6, async (escrow) => {
    let held: number[] = [];
    try {
      const info: any = await algod.accountInformation(escrow).do();
      held = (info.assets ?? []).filter((a: any) => Number(a.amount) >= 1).map((a: any) => Number(a["asset-id"]));
    } catch {
      return [];
    }
    if (!held.length) return [];

    const res = await fetch(`${indexerUrl}/v2/accounts/${escrow}/transactions?sig-type=lsig&limit=1`).then((r) =>
      r.json()
    );
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

export type UserSigner = (groups: Transaction[][], indexesToSign: number[]) => Promise<(Uint8Array | null)[]>;

/**
 * Signs every plan in one go (one wallet prompt, or locally with a secret
 * key) and submits them. The wallet sees each full group but only signs the
 * user's own transactions; escrow transactions are signed by the logic sig.
 */
export async function submitAlgoxCloses(
  algod: algosdk.Algodv2,
  plans: AlgoxClosePlan[],
  sign: { signer: UserSigner } | { sk: Uint8Array },
  onProgress?: (done: number, total: number, assetId: number, ok: boolean) => void
): Promise<{ assetId: number; txId?: string; error?: string }[]> {
  // Lay out: [optIn]? then [permission, assetClose, algoClose] per plan
  const groups: Transaction[][] = [];
  const indexesToSign: number[] = [];
  const slots: { optIn?: number; permission: number }[] = [];
  let flat = 0;
  for (const p of plans) {
    const slot: { optIn?: number; permission: number } = { permission: -1 };
    if (p.optIn) {
      groups.push([p.optIn]);
      slot.optIn = flat;
      indexesToSign.push(flat);
      flat += 1;
    }
    groups.push(p.group);
    slot.permission = flat;
    indexesToSign.push(flat);
    flat += 3;
    slots.push(slot);
  }

  let signed: (Uint8Array | null)[];
  if ("sk" in sign) {
    signed = groups.flat().map((t, i) => (indexesToSign.includes(i) ? t.signTxn(sign.sk) : null));
  } else {
    signed = await sign.signer(groups, indexesToSign);
  }

  const results: { assetId: number; txId?: string; error?: string }[] = [];
  for (const [i, p] of plans.entries()) {
    const slot = slots[i];
    try {
      if (slot.optIn !== undefined) {
        const optInBlob = signed[slot.optIn];
        if (!optInBlob) throw new Error("opt-in was not signed");
        const { txId } = await algod.sendRawTransaction(optInBlob).do();
        await algosdk.waitForConfirmation(algod, txId, 6);
      }
      const permissionBlob = signed[slot.permission];
      if (!permissionBlob) throw new Error("claim was not signed");
      const { txId } = await algod
        .sendRawTransaction([
          permissionBlob,
          lsigSign(p.group[1], p.listing.program),
          lsigSign(p.group[2], p.listing.program),
        ])
        .do();
      await algosdk.waitForConfirmation(algod, txId, 6);
      results.push({ assetId: p.listing.assetId, txId });
      onProgress?.(i + 1, plans.length, p.listing.assetId, true);
    } catch (e: any) {
      results.push({ assetId: p.listing.assetId, error: e?.message ?? String(e) });
      onProgress?.(i + 1, plans.length, p.listing.assetId, false);
    }
  }
  return results;
}
