import algosdk from "algosdk";
import { getAccountByAddress } from "../db/falconDb";

// Cache for PQ check results by address
interface PQCheckResult {
  isPQ: boolean;
  pqTxCount: number;
  reason?: string;
}

const pqCheckCache: Record<string, PQCheckResult> = {};

/**
 * Decode a base64 string to a utf-8 string safely.
 */
function safeBase64Decode(b64: string): string {
  try {
    return atob(b64);
  } catch {
    try {
      return Buffer.from(b64, "base64").toString("utf-8");
    } catch {
      return "";
    }
  }
}

/**
 * Check if a transaction SENT BY the target address contains a Post-Quantum signature.
 */
function isTxnPQFromSender(tx: any, targetAddress: string): boolean {
  if (!tx) return false;

  const sender = tx.sender || tx.txn?.sender || tx["sender"];
  if (!sender || sender.toUpperCase() !== targetAddress.toUpperCase()) {
    return false;
  }

  // 1. Check official Algorand protocol pqsig signature envelope
  if (tx.pqsig || tx.signature?.pqsig || tx["pqsig"]) {
    return true;
  }

  // 2. Check note field for explicit PQSIG tag
  if (tx.note) {
    const decodedNote = safeBase64Decode(tx.note);
    if (decodedNote.includes("PQSIG")) {
      return true;
    }
  }

  // 3. Check LogicSig program bytes for explicit PQSIG tag
  const lsig = tx.signature?.logicsig || tx.lsig || tx["logic-sig"];
  if (lsig?.logic) {
    const decodedLogic = safeBase64Decode(lsig.logic);
    if (decodedLogic.includes("PQSIG")) {
      return true;
    }
  }

  return false;
}

/**
 * Scan an address's transaction history on Algorand Indexer across Mainnet and Testnet
 * to detect if the account has SENT transactions with Post-Quantum (PQSIG) signatures,
 * and calculate the total count of PQ transactions.
 */
export async function checkIsPQAccount(
  address: string,
  network: "mainnet" | "testnet" | "betanet" = "mainnet"
): Promise<PQCheckResult> {
  if (!address || typeof address !== "string") {
    return { isPQ: false, pqTxCount: 0 };
  }

  const cacheKey = `${address}_${network}`;
  if (pqCheckCache[cacheKey] !== undefined) {
    return pqCheckCache[cacheKey];
  }

  let isLocalFalcon = false;
  try {
    const localAcc = await getAccountByAddress(address);
    if (localAcc) {
      isLocalFalcon = true;
    }
  } catch (err) {
    console.warn("Error checking falconDb:", err);
  }

  // Scan Indexer transaction history on selected network & fallback network
  const networksToTry = [
    network,
    network === "mainnet" ? "testnet" : "mainnet",
  ] as const;

  let totalPQTxCount = 0;
  let detectedNet: string | undefined = undefined;

  for (const net of networksToTry) {
    try {
      const indexerUrl = `https://${net}-idx.algonode.cloud`;
      const indexer = new algosdk.Indexer("", indexerUrl, "");
      const res = await indexer.searchForTransactions().address(address).limit(100).do();
      const txns = res.transactions || [];

      let netPQCount = 0;
      for (const tx of txns) {
        if (isTxnPQFromSender(tx, address)) {
          netPQCount++;
        }
      }

      if (netPQCount > 0) {
        totalPQTxCount += netPQCount;
        if (!detectedNet) detectedNet = net;
      }
    } catch (err) {
      console.warn(`Indexer search failed on ${net} for ${address}:`, err);
    }
  }

  if (isLocalFalcon && totalPQTxCount === 0) {
    totalPQTxCount = 1; // At least 1 local Falcon account
  }

  const isPQ = totalPQTxCount > 0 || isLocalFalcon;
  const reason = isLocalFalcon
    ? "Local Falcon Account"
    : isPQ
    ? `${totalPQTxCount} PQSIG transactions on ${detectedNet}`
    : undefined;

  const result: PQCheckResult = { isPQ, pqTxCount: totalPQTxCount, reason };
  pqCheckCache[cacheKey] = result;
  return result;
}

/**
 * Clear cache entirely.
 */
export function clearPQCache(): void {
  Object.keys(pqCheckCache).forEach((k) => delete pqCheckCache[k]);
}
