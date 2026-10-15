/**
 * PQ Tx Printer engine
 *
 * Burns the balance of a native Falcon-1024 account by firing 0-Algo
 * transactions (each one a real post-quantum signature on-chain) until only
 * the minimum balance is left, then closes the account out to a refund address.
 *
 * With coupons on, each print is a `print()` call to the PQCoupon app instead
 * of a self-payment, and the close-out claims the earned PQPRINT first.
 */

import algosdk from "algosdk";
import {
  nativePQFee,
  signNativePQTransaction,
  type NativePQAccount,
  type NativePQSignedTxn,
} from "./pqNative";
import {
  CLAIM_INNER_FEES,
  PQ_COUPON,
  PRINTER_BOX_MBR,
  buildClaimTxn,
  buildPrintTxn,
  buildRegisterTxns,
  getPendingCoupons,
  isOptedIn,
  type CouponDeployment,
} from "./pqCoupon";
import { SignerPool, type MessageSigner } from "./pqSignerPool";

export type PrinterNetwork = "mainnet" | "testnet";

export interface PrinterSession {
  version: 1;
  network: PrinterNetwork;
  account: NativePQAccount;
  refundTo: string;
  createdAt: number;
  /** Next sequence number to print; persisted so resumed sessions never reuse a note. */
  nextSeq: number;
  closed?: boolean;
  /** Earn PQPRINT coupons (prints go through the PQCoupon app). */
  coupons?: boolean;
}

export type ReceiptKind = "print" | "register" | "close";

export interface Receipt {
  seq: number;
  txID: string;
  sigBytes: number;
  status: "pending" | "confirmed" | "failed";
  round?: number;
  kind: ReceiptKind;
}

export interface PrinterCallbacks {
  onSubmitted: (receipts: Receipt[]) => void;
  onConfirmed: (txIDs: string[], round: number) => void;
  onFailed: (txIDs: string[], error: string) => void;
  onBalance: (microAlgos: number) => void;
  onSeq: (nextSeq: number) => void;
  /** Coupons earned so far by this printer (on-chain count, unclaimed). */
  onCoupons?: (pending: number) => void;
}

export interface PrinterResult {
  closed: boolean;
  refunded?: number;
  /** PQPRINT paid to the beneficiary on close-out. */
  coupons?: number;
  closeTxID?: string;
}

/** Max transactions in one atomic group. */
const GROUP_SIZE = 16;
/** Groups in flight at once (up to 256 PQ txns spread over the next block or two). */
const MAX_IN_FLIGHT = 16;
/** How long cached suggested params are reused (they stay valid for 1000 rounds). */
const PARAMS_TTL_MS = 20_000;
/** Consecutive failed groups before the printer gives up. */
const MAX_FAILURES = 3;

// ---------------------------------------------------------------------------
// Session persistence (the Falcon key must survive a reload, or funds strand)
// ---------------------------------------------------------------------------

const SESSION_KEY = "wentools-pq-printer";

export function loadSession(): PrinterSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as PrinterSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: PrinterSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage blocked: the session still works for this tab.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Chain helpers
// ---------------------------------------------------------------------------

export function getPrinterAlgod(network: PrinterNetwork) {
  return new algosdk.Algodv2("", `https://${network}-api.algonode.cloud`, "");
}

function getPrinterIndexer(network: PrinterNetwork) {
  return new algosdk.Indexer("", `https://${network}-idx.algonode.cloud`, "");
}

export async function fetchBalance(
  network: PrinterNetwork,
  address: string,
): Promise<{ amount: number; minBalance: number }> {
  const info: any = await getPrinterAlgod(network).accountInformation(address).do();
  return {
    amount: Number(info.amount ?? 0),
    minBalance: Number(info["min-balance"] ?? 100_000),
  };
}

/** Sender of the first payment into `address`, used as the default refund target. */
export async function findFunder(
  network: PrinterNetwork,
  address: string,
): Promise<string | null> {
  try {
    const res: any = await getPrinterIndexer(network)
      .searchForTransactions()
      .address(address)
      .addressRole("receiver")
      .txType("pay")
      .limit(1)
      .do();
    return res.transactions?.[0]?.sender ?? null;
  } catch {
    return null;
  }
}

/** On-chain count of transactions the printer sent; survives reloads and aborted runs. */
export async function countPrinted(network: PrinterNetwork, address: string): Promise<number> {
  const indexer = getPrinterIndexer(network);
  let count = 0;
  let next: string | undefined;
  do {
    let req = indexer.searchForTransactions().address(address).addressRole("sender").limit(1000);
    if (next) req = req.nextToken(next);
    const res: any = await req.do();
    count += res.transactions?.length ?? 0;
    next = res.transactions?.length ? res["next-token"] : undefined;
  } while (next);
  return count;
}

/** The coupon deployment a session prints through, if coupons are on and deployed. */
export function sessionCoupon(session: PrinterSession): CouponDeployment | null {
  return session.coupons ? PQ_COUPON[session.network] : null;
}

/**
 * ALGO a coupon printer must keep back beyond the minimum balance: the claim
 * fee, plus registration (2 txns + box deposit) if it hasn't registered yet.
 * The box deposit comes back on claim.
 */
function couponReserve(minFee: number, registered: boolean): number {
  const fee = nativePQFee(minFee);
  const claim = fee + CLAIM_INNER_FEES * minFee;
  return registered ? claim : claim + 2 * fee + PRINTER_BOX_MBR;
}

/** How many PQ txns the current balance can still print (excluding setup and close-out). */
export function estimatePrints(
  amount: number,
  minBalance: number,
  minFee = 1000,
  coupons?: { registered: boolean },
): number {
  if (amount <= 0) return 0;
  const reserve = coupons ? couponReserve(minFee, coupons.registered) : 0;
  return Math.max(0, Math.floor((amount - minBalance - reserve) / nativePQFee(minFee)));
}

function errorMessage(err: unknown): string {
  const e = err as any;
  return e?.response?.body?.message || e?.message || String(err);
}

function signAll(
  txns: algosdk.Transaction[],
  account: NativePQAccount,
  signer?: MessageSigner,
): Promise<NativePQSignedTxn[]> {
  return Promise.all(txns.map((txn) => signNativePQTransaction(txn, account, signer)));
}

/**
 * Settles every in-flight group with one status call per block plus one
 * pending-info lookup per group, instead of a polling loop per group.
 */
class ConfirmationTracker {
  private groups = new Map<
    string,
    { lastValid: number; resolve: (round: number) => void; reject: (err: Error) => void }
  >();
  private running = false;

  constructor(private readonly algod: algosdk.Algodv2) {}

  /** Resolves with the confirmed round of the group containing `txID`. */
  watch(txID: string, lastValid: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.groups.set(txID, { lastValid, resolve, reject });
      this.run();
    });
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    let round = Number((await this.algod.status().do())["last-round"]);
    while (this.groups.size) {
      try {
        round = Number((await this.algod.statusAfterBlock(round).do())["last-round"]);
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      await Promise.all(
        [...this.groups].map(async ([txID, g]) => {
          try {
            const info: any = await this.algod.pendingTransactionInformation(txID).do();
            const confirmed = Number(info["confirmed-round"] || 0);
            if (confirmed > 0) {
              this.groups.delete(txID);
              g.resolve(confirmed);
            } else if (info["pool-error"]) {
              this.groups.delete(txID);
              g.reject(new Error(info["pool-error"]));
            }
          } catch {
            // Not found: dropped from the pool, or a transient node error.
          }
          if (this.groups.has(txID) && round > g.lastValid) {
            this.groups.delete(txID);
            g.reject(new Error("transaction expired before confirming"));
          }
        }),
      );
    }
    this.running = false;
    if (this.groups.size) this.run();
  }
}

// ---------------------------------------------------------------------------
// The printer
// ---------------------------------------------------------------------------

export async function runPrinter(
  session: PrinterSession,
  signal: AbortSignal,
  cb: PrinterCallbacks,
): Promise<PrinterResult> {
  const pool = await SignerPool.create(session.account.secretKey);
  try {
    return await printWith(session, signal, cb, pool.sign);
  } finally {
    pool.terminate();
  }
}

async function printWith(
  session: PrinterSession,
  signal: AbortSignal,
  cb: PrinterCallbacks,
  sign: MessageSigner,
): Promise<PrinterResult> {
  const { network, account } = session;
  const algod = getPrinterAlgod(network);
  const encoder = new TextEncoder();
  const coupon = sessionCoupon(session);
  let seq = session.nextSeq;

  let { amount: balance, minBalance } = await fetchBalance(network, account.address);
  cb.onBalance(balance);

  // ── Coupon registration (once per printer; resumable) ───────────────────
  let pending = coupon ? await getPendingCoupons(algod, coupon, account.address) : null;
  if (coupon && pending === null) {
    const sp = await algod.getTransactionParams().do();
    const fee = nativePQFee(sp.minFee || 1000);
    const txns = buildRegisterTxns(coupon, account, session.refundTo, sp, fee);
    algosdk.assignGroupID(txns);
    const signed = await signAll(txns, account, sign);
    const receipts: Receipt[] = signed.map((s) => ({
      seq: seq,
      txID: s.txID,
      sigBytes: s.signatureBytes,
      status: "pending",
      kind: "register",
    }));
    cb.onSubmitted(receipts);
    try {
      await algod.sendRawTransaction(signed.map((s) => s.blob)).do();
      const res: any = await algosdk.waitForConfirmation(algod, signed[1].txID, 20);
      cb.onConfirmed(receipts.map((r) => r.txID), Number(res["confirmed-round"]));
    } catch (err) {
      cb.onFailed(receipts.map((r) => r.txID), errorMessage(err));
      throw new Error(`Coupon registration failed: ${errorMessage(err)}`);
    }
    pending = 0;
    ({ amount: balance, minBalance } = await fetchBalance(network, account.address));
    cb.onBalance(balance);
  }
  if (pending !== null) cb.onCoupons?.(pending);

  const reserveFor = (minFee: number) => (coupon ? couponReserve(minFee, true) : 0);

  const tracker = new ConfirmationTracker(algod);
  const inFlight = new Set<Promise<void>>();
  let failures = 0;
  let fatal: string | null = null;

  const fail = (txIDs: string[], cost: number, err: unknown) => {
    balance += cost;
    cb.onFailed(txIDs, errorMessage(err));
    if (++failures >= MAX_FAILURES) fatal = errorMessage(err);
  };

  /** Send a signed group and settle it, without blocking the next batch. */
  const launch = (signed: NativePQSignedTxn[], cost: number, lastValid: number) => {
    const txIDs = signed.map((s) => s.txID);
    const p = (async () => {
      try {
        await algod.sendRawTransaction(signed.map((s) => s.blob)).do();
      } catch (err) {
        return fail(txIDs, cost, err);
      }
      try {
        const round = await tracker.watch(txIDs[0], lastValid);
        failures = 0;
        cb.onConfirmed(txIDs, round);
        if (pending !== null) cb.onCoupons?.((pending += txIDs.length));
      } catch (err) {
        fail(txIDs, cost, err);
      }
    })().finally(() => inFlight.delete(p));
    inFlight.add(p);
  };

  // Params only change per round and stay valid for 1000 rounds: refresh occasionally.
  let sp = await algod.getTransactionParams().do();
  let spFetchedAt = Date.now();

  while (!signal.aborted && !fatal) {
    if (Date.now() - spFetchedAt > PARAMS_TTL_MS) {
      sp = await algod.getTransactionParams().do();
      spFetchedAt = Date.now();
    }
    const minFee = sp.minFee || 1000;
    const fee = nativePQFee(minFee);
    const count = Math.min(
      GROUP_SIZE,
      Math.floor((balance - minBalance - reserveFor(minFee)) / fee),
    );

    if (count <= 0) {
      // Out of fees by our estimate: settle in-flight work, then re-check the
      // chain in case someone topped the printer up mid-run.
      await Promise.all(inFlight);
      ({ amount: balance, minBalance } = await fetchBalance(network, account.address));
      cb.onBalance(balance);
      if (balance - minBalance - reserveFor(minFee) >= fee && !signal.aborted && !fatal) continue;
      break;
    }

    const txns = Array.from({ length: count }, () => {
      const note = encoder.encode(`wen.tools PQ printer · falcon-1024 · #${seq++}`);
      return coupon
        ? buildPrintTxn(coupon, account.address, sp, fee, note)
        : algosdk.makePaymentTxnWithSuggestedParamsFromObject({
            from: account.address,
            to: account.address,
            amount: 0,
            note,
            suggestedParams: { ...sp, fee, flatFee: true },
          });
    });
    if (txns.length > 1) algosdk.assignGroupID(txns);

    const signed = await signAll(txns, account, sign);
    const firstSeq = seq - count;
    cb.onSeq(seq);

    const cost = count * fee;
    balance -= cost;
    cb.onBalance(balance);
    cb.onSubmitted(
      signed.map((s, i) => ({
        seq: firstSeq + i,
        txID: s.txID,
        sigBytes: s.signatureBytes,
        status: "pending",
        kind: "print",
      })),
    );
    launch(signed, cost, Number(sp.lastRound));

    if (inFlight.size >= MAX_IN_FLIGHT) await Promise.race(inFlight);
  }

  await Promise.all(inFlight);
  if (fatal) throw new Error(fatal);
  if (signal.aborted) return { closed: false };

  return closeOut(session, seq, cb, sign);
}

/**
 * Final PQ transaction(s): claim any coupons, then close the account and send
 * everything left (including the refunded box deposit) to the refund address.
 */
async function closeOut(
  session: PrinterSession,
  seq: number,
  cb: PrinterCallbacks,
  sign: MessageSigner,
): Promise<PrinterResult> {
  const { network, account, refundTo } = session;
  const algod = getPrinterAlgod(network);
  const coupon = sessionCoupon(session);
  const { amount } = await fetchBalance(network, account.address);
  const sp = await algod.getTransactionParams().do();
  const minFee = sp.minFee || 1000;
  const fee = nativePQFee(minFee);

  // Throws on node errors rather than guessing "not registered" and closing without a claim.
  const pending = coupon ? await getPendingCoupons(algod, coupon, account.address) : null;
  // claim() forfeits coupons (but still refunds the deposit) if the beneficiary opted out.
  const paid =
    coupon && pending !== null && (await isOptedIn(algod, coupon, refundTo)) ? pending : 0;
  const claimFee = fee + CLAIM_INNER_FEES * minFee;
  const totalFees = pending !== null ? claimFee + fee : fee;
  if (amount < totalFees) return { closed: amount === 0 };

  const txns: algosdk.Transaction[] = [];
  if (coupon && pending !== null) {
    txns.push(buildClaimTxn(coupon, account.address, refundTo, sp, claimFee));
  }
  txns.push(
    algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: account.address,
      to: refundTo,
      amount: 0,
      closeRemainderTo: refundTo,
      note: new TextEncoder().encode(`wen.tools PQ printer · falcon-1024 · #${seq} · close`),
      suggestedParams: { ...sp, fee, flatFee: true },
    }),
  );
  if (txns.length > 1) algosdk.assignGroupID(txns);

  const signed = await signAll(txns, account, sign);
  const closeTx = signed[signed.length - 1];
  cb.onSeq(seq + 1);
  cb.onSubmitted(
    signed.map((s) => ({
      seq,
      txID: s.txID,
      sigBytes: s.signatureBytes,
      status: "pending" as const,
      kind: "close" as const,
    })),
  );

  try {
    await algod.sendRawTransaction(signed.map((s) => s.blob)).do();
    const res: any = await algosdk.waitForConfirmation(algod, closeTx.txID, 20);
    cb.onConfirmed(
      signed.map((s) => s.txID),
      Number(res["confirmed-round"]),
    );
  } catch (err) {
    cb.onFailed(
      signed.map((s) => s.txID),
      errorMessage(err),
    );
    throw err;
  }
  cb.onBalance(0);
  const deposit = pending !== null ? PRINTER_BOX_MBR : 0;
  return {
    closed: true,
    refunded: amount + deposit - totalFees,
    coupons: pending !== null ? paid : undefined,
    closeTxID: closeTx.txID,
  };
}
