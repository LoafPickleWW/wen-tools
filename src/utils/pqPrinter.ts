/**
 * PQ Tx Printer engine
 *
 * Burns the balance of a native Falcon-1024 account by firing 0-Algo
 * self-payments (each one a real post-quantum signature on-chain) until only
 * the minimum balance is left, then closes the account out to a refund address.
 */

import algosdk from "algosdk";
import {
  nativePQFee,
  signNativePQTransaction,
  type NativePQAccount,
} from "./pqNative";

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
}

export interface Receipt {
  seq: number;
  txID: string;
  sigBytes: number;
  status: "pending" | "confirmed" | "failed";
  round?: number;
  close?: boolean;
}

export interface PrinterCallbacks {
  onSubmitted: (receipts: Receipt[]) => void;
  onConfirmed: (txIDs: string[], round: number) => void;
  onFailed: (txIDs: string[], error: string) => void;
  onBalance: (microAlgos: number) => void;
  onSeq: (nextSeq: number) => void;
}

export interface PrinterResult {
  closed: boolean;
  refunded?: number;
  closeTxID?: string;
}

/** Max transactions in one atomic group. */
const GROUP_SIZE = 16;
/** Groups awaiting confirmation at once (≈64 PQ txns per round). */
const MAX_IN_FLIGHT = 4;
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

/** How many PQ txns the current balance can still print (excluding the close-out). */
export function estimatePrints(amount: number, minBalance: number, minFee = 1000): number {
  if (amount <= 0) return 0;
  return Math.max(0, Math.floor((amount - minBalance) / nativePQFee(minFee)));
}

function errorMessage(err: unknown): string {
  const e = err as any;
  return e?.response?.body?.message || e?.message || String(err);
}

// ---------------------------------------------------------------------------
// The printer
// ---------------------------------------------------------------------------

export async function runPrinter(
  session: PrinterSession,
  signal: AbortSignal,
  cb: PrinterCallbacks,
): Promise<PrinterResult> {
  const { network, account } = session;
  const algod = getPrinterAlgod(network);
  const encoder = new TextEncoder();
  let seq = session.nextSeq;

  let { amount: balance, minBalance } = await fetchBalance(network, account.address);
  cb.onBalance(balance);

  const inFlight = new Set<Promise<void>>();
  let failures = 0;
  let fatal: string | null = null;

  const confirmGroup = async (txIDs: string[], cost: number) => {
    try {
      const res: any = await algosdk.waitForConfirmation(algod, txIDs[0], 20);
      failures = 0;
      cb.onConfirmed(txIDs, Number(res["confirmed-round"]));
    } catch (err) {
      balance += cost;
      cb.onFailed(txIDs, errorMessage(err));
      if (++failures >= MAX_FAILURES) fatal = errorMessage(err);
    }
  };

  while (!signal.aborted && !fatal) {
    const sp = await algod.getTransactionParams().do();
    const fee = nativePQFee(sp.minFee || 1000);
    const count = Math.min(GROUP_SIZE, Math.floor((balance - minBalance) / fee));

    if (count <= 0) {
      // Out of fees by our estimate: settle in-flight work, then re-check the
      // chain in case someone topped the printer up mid-run.
      await Promise.all(inFlight);
      ({ amount: balance, minBalance } = await fetchBalance(network, account.address));
      cb.onBalance(balance);
      if (balance - minBalance >= fee && !signal.aborted && !fatal) continue;
      break;
    }

    const txns = Array.from({ length: count }, () =>
      algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: account.address,
        to: account.address,
        amount: 0,
        note: encoder.encode(`wen.tools PQ printer · falcon-1024 · #${seq++}`),
        suggestedParams: { ...sp, fee, flatFee: true },
      }),
    );
    if (txns.length > 1) algosdk.assignGroupID(txns);

    const signed = [];
    for (const txn of txns) signed.push(await signNativePQTransaction(txn, account));
    const firstSeq = seq - count;
    cb.onSeq(seq);

    const receipts: Receipt[] = signed.map((s, i) => ({
      seq: firstSeq + i,
      txID: s.txID,
      sigBytes: s.signatureBytes,
      status: "pending",
    }));
    const txIDs = receipts.map((r) => r.txID);
    const cost = count * fee;

    try {
      await algod.sendRawTransaction(signed.map((s) => s.blob)).do();
    } catch (err) {
      cb.onSubmitted(receipts);
      cb.onFailed(txIDs, errorMessage(err));
      if (++failures >= MAX_FAILURES) fatal = errorMessage(err);
      // Re-sync: the failure may be a stale balance estimate.
      ({ amount: balance, minBalance } = await fetchBalance(network, account.address));
      continue;
    }

    balance -= cost;
    cb.onBalance(balance);
    cb.onSubmitted(receipts);

    const p = confirmGroup(txIDs, cost).finally(() => inFlight.delete(p));
    inFlight.add(p);
    if (inFlight.size >= MAX_IN_FLIGHT) await Promise.race(inFlight);
  }

  await Promise.all(inFlight);
  if (fatal) throw new Error(fatal);
  if (signal.aborted) return { closed: false };

  return closeOut(session, seq, cb);
}

/** Final PQ transaction: close the account and send everything left to the refund address. */
async function closeOut(
  session: PrinterSession,
  seq: number,
  cb: PrinterCallbacks,
): Promise<PrinterResult> {
  const { network, account, refundTo } = session;
  const algod = getPrinterAlgod(network);
  const { amount } = await fetchBalance(network, account.address);
  const sp = await algod.getTransactionParams().do();
  const fee = nativePQFee(sp.minFee || 1000);
  if (amount < fee) return { closed: amount === 0 };

  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: account.address,
    to: refundTo,
    amount: 0,
    closeRemainderTo: refundTo,
    note: new TextEncoder().encode(`wen.tools PQ printer · falcon-1024 · #${seq} · close`),
    suggestedParams: { ...sp, fee, flatFee: true },
  });
  const signed = await signNativePQTransaction(txn, account);
  cb.onSeq(seq + 1);
  cb.onSubmitted([
    { seq, txID: signed.txID, sigBytes: signed.signatureBytes, status: "pending", close: true },
  ]);

  try {
    await algod.sendRawTransaction(signed.blob).do();
    const res: any = await algosdk.waitForConfirmation(algod, signed.txID, 20);
    cb.onConfirmed([signed.txID], Number(res["confirmed-round"]));
  } catch (err) {
    cb.onFailed([signed.txID], errorMessage(err));
    throw err;
  }
  cb.onBalance(0);
  return { closed: true, refunded: amount - fee, closeTxID: signed.txID };
}
