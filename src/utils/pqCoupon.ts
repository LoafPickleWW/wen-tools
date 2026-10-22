/**
 * Client for the PQCoupon contract (contracts/PQCoupon.algo.ts).
 *
 * A registered native PQ printer earns 1 PQPRINT per `print()` app call; the
 * coupons are paid to its beneficiary on `claim()`, which also refunds the
 * printer's box deposit.
 */

import algosdk from "algosdk";
import Falcon from "falcon-signatures";
import type { PrinterNetwork } from "./pqPrinter";
import type { NativePQAccount } from "./pqNative";

export interface CouponDeployment {
  appId: number;
  assetId: number;
}

/** null = not deployed on that network yet. */
export const PQ_COUPON: Record<PrinterNetwork, CouponDeployment | null> = {
  testnet: { appId: 774341440, assetId: 774341444 },
  mainnet: { appId: 3742488917, assetId: 3742488975 },
};

/** Box deposit held by the app while a printer is registered (refunded on claim). */
export const PRINTER_BOX_MBR = 31_700;
/** claim() sends two inner transactions the caller pays for. */
export const CLAIM_INNER_FEES = 2;
export const COUPON_DECIMALS = 6;

const REGISTER = algosdk.ABIMethod.fromSignature("register(byte[],address,pay)void");
const PRINT = algosdk.ABIMethod.fromSignature("print()void");
const CLAIM = algosdk.ABIMethod.fromSignature("claim()uint64");

function printerBox(appId: number, printer: string) {
  return {
    appIndex: appId,
    name: new Uint8Array([0x70, ...algosdk.decodeAddress(printer).publicKey]), // "p" + address
  };
}

/**
 * Coupons owed to a printer that has registered but not claimed, or null if not registered.
 * Only a 404 means "not registered": any other error is rethrown, because treating a flaky
 * node as unregistered would make the printer close out without claiming.
 */
export async function getPendingCoupons(
  algod: algosdk.Algodv2,
  deployment: CouponDeployment,
  printer: string,
): Promise<number | null> {
  try {
    const box = await algod
      .getApplicationBoxByName(deployment.appId, printerBox(deployment.appId, printer).name)
      .do();
    return Number(new DataView(box.value.buffer, box.value.byteOffset).getBigUint64(32));
  } catch (err: any) {
    if ((err?.status ?? err?.response?.status) === 404) return null;
    throw err;
  }
}

/** Whether `address` can receive PQPRINT. */
export async function isOptedIn(
  algod: algosdk.Algodv2,
  deployment: CouponDeployment,
  address: string,
): Promise<boolean> {
  try {
    await algod.accountAssetInformation(address, deployment.assetId).do();
    return true;
  } catch {
    return false;
  }
}

/** [box deposit payment, register call], both sent by the printer. Caller groups and signs. */
export function buildRegisterTxns(
  deployment: CouponDeployment,
  account: NativePQAccount,
  beneficiary: string,
  sp: algosdk.SuggestedParams,
  fee: number,
): algosdk.Transaction[] {
  const pqKey = new Uint8Array([account.salt, ...Falcon.hexToBytes(account.publicKey)]);
  const deposit = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: account.address,
    receiver: algosdk.getApplicationAddress(deployment.appId),
    amount: PRINTER_BOX_MBR,
    suggestedParams: { ...sp, fee, flatFee: true },
  });
  const register = algosdk.makeApplicationNoOpTxnFromObject({
    sender: account.address,
    appIndex: deployment.appId,
    appArgs: [
      REGISTER.getSelector(),
      algosdk.ABIType.from("byte[]").encode(pqKey),
      algosdk.decodeAddress(beneficiary).publicKey,
    ],
    boxes: [printerBox(deployment.appId, account.address)],
    // register() checks the beneficiary is opted in to PQPRINT
    accounts: [beneficiary],
    foreignAssets: [deployment.assetId],
    suggestedParams: { ...sp, fee, flatFee: true },
  });
  return [deposit, register];
}

export function buildPrintTxn(
  deployment: CouponDeployment,
  printer: string,
  sp: algosdk.SuggestedParams,
  fee: number,
  note: Uint8Array,
): algosdk.Transaction {
  return algosdk.makeApplicationNoOpTxnFromObject({
    sender: printer,
    appIndex: deployment.appId,
    appArgs: [PRINT.getSelector()],
    boxes: [printerBox(deployment.appId, printer)],
    note,
    suggestedParams: { ...sp, fee, flatFee: true },
  });
}

export function buildClaimTxn(
  deployment: CouponDeployment,
  printer: string,
  beneficiary: string,
  sp: algosdk.SuggestedParams,
  fee: number,
): algosdk.Transaction {
  return algosdk.makeApplicationNoOpTxnFromObject({
    sender: printer,
    appIndex: deployment.appId,
    appArgs: [CLAIM.getSelector()],
    boxes: [printerBox(deployment.appId, printer)],
    foreignAssets: [deployment.assetId],
    accounts: [beneficiary],
    suggestedParams: { ...sp, fee, flatFee: true },
  });
}

export interface CouponHolder {
  address: string;
  amount: number; // whole PQPRINT
}

/** All PQPRINT holders, largest first, excluding the app (creator + reserve). */
export async function getTopHolders(
  network: PrinterNetwork,
  deployment: CouponDeployment,
  /** Omit for every holder, ranked. */
  limit?: number,
): Promise<CouponHolder[]> {
  const indexer = new algosdk.Indexer("", `https://${network}-idx.algonode.cloud`, "");
  const exclude = algosdk.getApplicationAddress(deployment.appId).toString();
  const holders: CouponHolder[] = [];
  let next: string | undefined;
  do {
    let req = indexer.lookupAssetBalances(deployment.assetId).currencyGreaterThan(0).limit(1000);
    if (next) req = req.nextToken(next);
    const res: any = await req.do();
    for (const b of res.balances ?? []) {
      if (b.address === exclude || b.deleted) continue;
      holders.push({ address: b.address, amount: Number(b.amount) / 10 ** COUPON_DECIMALS });
    }
    next = res.balances?.length ? res.nextToken : undefined;
  } while (next);
  holders.sort((a, b) => b.amount - a.amount);
  return limit === undefined ? holders : holders.slice(0, limit);
}
