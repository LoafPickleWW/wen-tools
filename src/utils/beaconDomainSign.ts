import algosdk from "algosdk";
import { extractSignatureBytes } from "./deadDropCrypto";

type SignFn = (txns: Uint8Array[]) => Promise<(Uint8Array | null)[]>;

const EXPIRED_RE = /expired|already\s+(been\s+)?submitted/i;

function buildDomainTxn(
  address: string,
  note: string,
  genesisHashB64: string,
  firstValid: number,
  lastValid: number
) {
  return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: address,
    receiver: address,
    amount: 0,
    note: new TextEncoder().encode(note),
    suggestedParams: {
      genesisHash: algosdk.base64ToBytes(genesisHashB64),
      genesisID: "mainnet-v1.0",
      firstValid,
      lastValid,
      fee: 0,
      minFee: 1000, // required by the type; not encoded
      flatFee: true,
    },
  });
}

/**
 * Signs the (never submitted) BEACON domain transaction and returns the raw
 * signature bytes used to derive the BEACON encryption key.
 *
 * The legacy round window (10-20) is tried first so existing keys are unchanged.
 * Some wallets (e.g. Pera/Defly) reject it as expired; only then is a wide window
 * tried, which yields a different (but stable) key for those wallets.
 */
export async function signBeaconDomainTxn(
  address: string,
  signTransactions: SignFn,
  note: string,
  genesisHashB64: string
): Promise<Uint8Array> {
  const attempt = async (firstValid: number, lastValid: number) => {
    const txn = buildDomainTxn(address, note, genesisHashB64, firstValid, lastValid);
    const signed = await signTransactions([algosdk.encodeUnsignedTransaction(txn)]);
    if (!signed || !signed[0]) throw new Error("Cancelled auth signature");
    const sig = extractSignatureBytes(algosdk.decodeSignedTransaction(signed[0]));
    if (!sig) throw new Error("No signature found");
    return sig;
  };

  try {
    return await attempt(10, 20);
  } catch (err: any) {
    if (!EXPIRED_RE.test(String(err?.message ?? err))) throw err;
    return attempt(1, Number.MAX_SAFE_INTEGER);
  }
}
