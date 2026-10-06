/**
 * WenPad Random Sale — frontend helpers on top of wenpadSaleCore.
 */

import algosdk from "algosdk";
import { getAlgod, type SaleNetwork } from "./wenpadSaleCore";
import { walletSign } from "../utils";

export * from "./wenpadSaleCore";

const FACTORY_IDS: Record<SaleNetwork, number> = {
  // Mainnet 3732112982 is retired (older build, no Shuffles were created on it)
  mainnet: Number(import.meta.env.VITE_WENPAD_SALE_FACTORY_APP_ID_MAINNET || 3732147516),
  // Earlier testnet factories (773802844, 773804149, 773804369, 773806155, 773807620) are retired: older builds
  testnet: Number(import.meta.env.VITE_WENPAD_SALE_FACTORY_APP_ID_TESTNET || 773809724),
};

export const getFactoryId = (network: SaleNetwork) => FACTORY_IDS[network];

export const toSaleNetwork = (network?: string | null): SaleNetwork =>
  network === "testnet" ? "testnet" : "mainnet";

/**
 * Sign a finalized group with the connected wallet, send it, and wait for confirmation.
 * Returns the confirmation of the transaction at `confirmIndex` (default: the last one).
 */
export async function signAndSend(
  network: SaleNetwork,
  txns: algosdk.Transaction[],
  signer: algosdk.TransactionSigner,
  confirmIndex = txns.length - 1
): Promise<any> {
  const algod = getAlgod(network);
  const signed = await walletSign(txns, signer);
  if (!signed || signed.length !== txns.length) throw new Error("Transaction signing was cancelled");
  await algod.sendRawTransaction(signed).do();
  return algosdk.waitForConfirmation(algod, txns[confirmIndex].txID(), 8);
}

/** Ask the keeper endpoint to reveal a commit. Returns the delivered asset, or null if it could not. */
export async function requestKeeperReveal(
  network: SaleNetwork,
  appId: number,
  commitId: number
): Promise<{ txId: string; assetId: number } | null> {
  try {
    const res = await fetch("/api/wenpad-reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ network, appId, commitId }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ─── Hand-off from the WenPad mint step to the sale launcher ─────────────────

const LAST_MINT_KEY = "wenpad:lastMint";

export interface LastMintInfo {
  network: SaleNetwork;
  creator: string;
  name: string;
  unitName: string;
  standard: string;
  count: number;
  mintedAt: number;
}

export function saveLastMint(info: LastMintInfo) {
  try {
    localStorage.setItem(LAST_MINT_KEY, JSON.stringify(info));
  } catch {
    // storage unavailable; the launcher just starts empty
  }
}

export function loadLastMint(): LastMintInfo | null {
  try {
    const raw = localStorage.getItem(LAST_MINT_KEY);
    return raw ? (JSON.parse(raw) as LastMintInfo) : null;
  } catch {
    return null;
  }
}

// ─── In-progress launch persistence (survives switching wallets) ─────────────

const LAUNCH_KEY = "wenpad:launchProgress";

export interface LaunchProgress {
  network: SaleNetwork;
  admin: string;
  distribution: string;
  saleId: number;
  appId: number;
  assetIds: number[];
  itemsAdded: number;
}

export function saveLaunchProgress(p: LaunchProgress | null) {
  try {
    if (p) localStorage.setItem(LAUNCH_KEY, JSON.stringify(p));
    else localStorage.removeItem(LAUNCH_KEY);
  } catch {
    // ignore
  }
}

export function loadLaunchProgress(): LaunchProgress | null {
  try {
    const raw = localStorage.getItem(LAUNCH_KEY);
    return raw ? (JSON.parse(raw) as LaunchProgress) : null;
  } catch {
    return null;
  }
}
