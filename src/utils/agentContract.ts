/**
 * Agent Marketplace — Contract Interaction Utilities
 *
 * All smart contract interaction logic for the on-chain agent registry.
 * Factory/child pattern: factory deploys one child app per wallet,
 * child stores listing metadata in global state.
 */

import algosdk from "algosdk";
import { NetworkId } from "@txnlab/use-wallet-react";
import type { AgentListing, CreateListingParams } from "../types/agent";

// ─── Config ──────────────────────────────────────────────────────────────────

const FACTORY_APP_IDS: Record<string, number> = {
  mainnet: Number(import.meta.env.VITE_FACTORY_APP_ID_MAINNET || 3565950332),
  testnet: Number(import.meta.env.VITE_FACTORY_APP_ID_TESTNET || 762952995),
};

function getAlgodClient(network: NetworkId): algosdk.Algodv2 {
  const base = network === NetworkId.TESTNET
    ? "https://testnet-api.4160.nodely.dev"
    : "https://mainnet-api.4160.nodely.dev";
  return new algosdk.Algodv2("", base, "");
}

function getIndexerBase(network: NetworkId): string {
  return network === NetworkId.TESTNET
    ? "https://testnet-idx.algonode.cloud"
    : "https://mainnet-idx.algonode.cloud";
}

function getFactoryAppId(network: NetworkId): number {
  const key = network === NetworkId.TESTNET ? "testnet" : "mainnet";
  return FACTORY_APP_IDS[key];
}

// Helper to decode Base64 to Uint8Array
function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function decodeGlobalState(
  appId: number,
  nonce: number,
  state: Array<{ key: string; value: { type: number; bytes?: string; uint?: number } }>
): AgentListing {
  const kv: Record<string, string | number | Uint8Array> = {};
  for (const entry of state) {
    const key = atob(entry.key);
    if (entry.value.type === 1) {
      kv[key] = base64ToBytes(entry.value.bytes || "");
    } else {
      kv[key] = entry.value.uint ?? 0;
    }
  }

  const getStringValue = (key: string): string => {
    const val = kv[key];
    if (val instanceof Uint8Array) {
      if (val.length < 2) return "";
      // ABI strings have a 2-byte uint16 length prefix
      const length = (val[0] << 8) | val[1];
      const stringBytes = val.subarray(2, 2 + length);
      try {
        return new TextDecoder().decode(stringBytes);
      } catch (e) {
        console.error(`Failed to decode UTF-8 string for key "${key}":`, e);
        return "";
      }
    }
    return typeof val === "string" ? val : "";
  };

  const getAddressValue = (key: string): string => {
    const val = kv[key];
    if (val instanceof Uint8Array) {
      if (val.length === 32) {
        try {
          return algosdk.encodeAddress(val);
        } catch (e) {
          console.error(`Failed to encode Algorand address for key "${key}":`, e);
        }
      }
      try {
        return new TextDecoder().decode(val);
      } catch {
        return "";
      }
    }
    return typeof val === "string" ? val : "";
  };

  const priceRaw = typeof kv["price_algo"] === "number" ? kv["price_algo"] : 0;

  return {
    appId,
    nonce,
    name: getStringValue("name"),
    description: getStringValue("description"),
    endpointUrl: getStringValue("endpoint_url"),
    pricePerCallAlgo: priceRaw / 1_000_000,
    category: getStringValue("category") || "other",
    walletAddress: getAddressValue("wallet_address"),
    active: kv["active"] === 1,
    x402Compatible: false, // Will be determined by endpoint probing in the future
    infoUrl: getStringValue("info_url"),
  };
}

// ─── Read operations ─────────────────────────────────────────────────────────

/**
 * Fetch all active listings by scanning the factory contract's boxes.
 * Each box maps a wallet address to a child app ID.
 */
export async function getAllListings(network: NetworkId): Promise<AgentListing[]> {
  const factoryId = getFactoryAppId(network);
  if (!factoryId) return [];

  const indexerBase = getIndexerBase(network);
  const algod = getAlgodClient(network);

  try {
    // 1. Get all boxes from the factory
    const boxesRes = await fetch(
      `${indexerBase}/v2/applications/${factoryId}/boxes?limit=100`
    );
    if (!boxesRes.ok) return [];
    const boxesData = await boxesRes.json();
    const boxes: Array<{ name: string }> = boxesData.boxes || [];

    if (boxes.length === 0) return [];

    // 2. Read each box to get child app IDs
    const listings: AgentListing[] = [];

    for (const box of boxes) {
      try {
        const boxNameBytes = new Uint8Array(Buffer.from(box.name, "base64"));
        
        // Extract nonce from the last 8 bytes
        const nonceBytes = boxNameBytes.slice(32, 40);
        const nonceView = new DataView(nonceBytes.buffer);
        const nonce = Number(nonceView.getBigUint64(0));

        // Read box value (child app ID as uint64)
        const boxRes = await algod
          .getApplicationBoxByName(factoryId, boxNameBytes)
          .do();

        // Decode uint64 from 8-byte value
        const view = new DataView(new Uint8Array(boxRes.value).buffer);
        const childAppId = Number(view.getBigUint64(0));

        if (childAppId === 0) continue;

        // 3. Read child app global state
        const appRes = await fetch(
          `${indexerBase}/v2/applications/${childAppId}`
        );
        if (!appRes.ok) continue;
        const appData = await appRes.json();
        const globalState = appData.application?.params?.["global-state"];
        if (!globalState) continue;

        const listing = decodeGlobalState(childAppId, nonce, globalState);
        if (listing.active) {
          listings.push(listing);
        }
      } catch {
        // Skip individual failures
        continue;
      }
    }

    return listings;
  } catch (err) {
    console.error("getAllListings error:", err);
    return [];
  }
}

export async function getListingByWallet() {
  return null;
}

// ─── Write operations ────────────────────────────────────────────────────────

/**
 * Build the transaction group for creating a new listing.
 * Returns unsigned transactions for wallet signing.
 */
export async function buildCreateListingTxns(
  params: CreateListingParams,
  senderAddress: string,
  network: NetworkId
): Promise<Uint8Array[]> {
  const factoryId = getFactoryAppId(network);
  if (!factoryId) throw new Error("Factory app not configured for this network");

  const algod = getAlgodClient(network);
  const indexerBase = getIndexerBase(network);
  const suggestedParams = await algod.getTransactionParams().do();

  // Read the next_nonce from the factory global state
  let nextNonce = 1;
  try {
    const appRes = await fetch(`${indexerBase}/v2/applications/${factoryId}`);
    if (appRes.ok) {
      const appData = await appRes.json();
      const globalState = appData.application?.params?.["global-state"] || [];
      const nonceObj = globalState.find((st: any) => atob(st.key) === "next_nonce");
      if (nonceObj && nonceObj.value && nonceObj.value.uint !== undefined) {
        nextNonce = nonceObj.value.uint;
      }
    }
  } catch (e) {
    console.error("Failed to fetch next_nonce, defaulting to 1", e);
  }

  const mbrPayment = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: senderAddress,
    to: algosdk.getApplicationAddress(factoryId),
    amount: 478_700, // Box MBR (21.7k) + Child App MBR (457k)
    suggestedParams,
  });

  const priceMicro = Math.round(params.priceAlgo * 1_000_000);

  const atc = new algosdk.AtomicTransactionComposer();
  const dummySigner = async () => [];

  // Build the expected box name (40 bytes: sender address + nonce)
  const addrBytes = algosdk.decodeAddress(senderAddress).publicKey;
  const nonceBytes = new Uint8Array(8);
  new DataView(nonceBytes.buffer).setBigUint64(0, BigInt(nextNonce));
  const boxName = new Uint8Array(40);
  boxName.set(addrBytes, 0);
  boxName.set(nonceBytes, 32);

  atc.addMethodCall({
    appID: factoryId,
    method: algosdk.ABIMethod.fromSignature("create_listing(pay,string,string,string,uint64,string,string)uint64"),
    methodArgs: [
      { txn: mbrPayment, signer: dummySigner },
      params.name,
      params.description,
      params.endpointUrl,
      priceMicro,
      params.category,
      params.infoUrl || ""
    ],
    sender: senderAddress,
    suggestedParams: { ...suggestedParams, fee: 2000, flatFee: true },
    signer: dummySigner,
    boxes: [{ appIndex: factoryId, name: boxName }],
  });

  const group = atc.buildGroup();
  return group.map(g => algosdk.encodeUnsignedTransaction(g.txn));
}

/**
 * Build the transaction for updating an existing listing.
 */
export async function buildUpdateListingTxns(
  childAppId: number,
  params: CreateListingParams,
  senderAddress: string,
  network: NetworkId
): Promise<Uint8Array[]> {
  const algod = getAlgodClient(network);
  const suggestedParams = await algod.getTransactionParams().do();

  const priceMicro = Math.round(params.priceAlgo * 1_000_000);

  const atc = new algosdk.AtomicTransactionComposer();
  const dummySigner = async () => [];

  atc.addMethodCall({
    appID: childAppId,
    method: algosdk.ABIMethod.fromSignature("update_listing(string,string,string,uint64,string,string)void"),
    methodArgs: [
      params.name,
      params.description,
      params.endpointUrl,
      priceMicro,
      params.category,
      params.infoUrl || ""
    ],
    sender: senderAddress,
    suggestedParams,
    signer: dummySigner,
  });

  const group = atc.buildGroup();
  return group.map(g => algosdk.encodeUnsignedTransaction(g.txn));
}

/**
 * Build the transaction for deactivating a listing.
 */
export async function buildDeactivateListingTxn(
  childAppId: number,
  senderAddress: string,
  network: NetworkId
): Promise<Uint8Array[]> {
  const algod = getAlgodClient(network);
  const suggestedParams = await algod.getTransactionParams().do();

  const atc = new algosdk.AtomicTransactionComposer();
  const dummySigner = async () => [];

  atc.addMethodCall({
    appID: childAppId,
    method: algosdk.ABIMethod.fromSignature("deactivate_listing()void"),
    methodArgs: [],
    sender: senderAddress,
    suggestedParams,
    signer: dummySigner,
  });

  const group = atc.buildGroup();
  return group.map(g => algosdk.encodeUnsignedTransaction(g.txn));
}

/**
 * Build the transaction for deleting a listing (destroys child app + cleans factory box).
 * Returns a grouped pair: [delete child app, delete factory box entry].
 */
export async function buildDeleteListingTxns(
  childAppId: number,
  nonce: number,
  senderAddress: string,
  network: NetworkId
): Promise<Uint8Array[]> {
  const factoryId = getFactoryAppId(network);
  if (!factoryId) throw new Error("Factory app not configured for this network");

  const algod = getAlgodClient(network);
  const suggestedParams = await algod.getTransactionParams().do();

  const atc = new algosdk.AtomicTransactionComposer();
  const dummySigner = async () => [];

  // Factory delete_listing now handles deleting the child app internally.
  const addrBytes = algosdk.decodeAddress(senderAddress).publicKey;
  const nonceBytes = new Uint8Array(8);
  new DataView(nonceBytes.buffer).setBigUint64(0, BigInt(nonce));
  const boxName = new Uint8Array(40);
  boxName.set(addrBytes, 0);
  boxName.set(nonceBytes, 32);

  atc.addMethodCall({
    appID: factoryId,
    method: algosdk.ABIMethod.fromSignature("delete_listing(uint64)void"),
    methodArgs: [nonce],
    sender: senderAddress,
    suggestedParams: { ...suggestedParams, fee: 2000, flatFee: true }, // Inner txn fee coverage
    signer: dummySigner,
    boxes: [{ appIndex: factoryId, name: boxName }],
    appForeignApps: [childAppId],
  });

  const group = atc.buildGroup();
  return group.map(g => algosdk.encodeUnsignedTransaction(g.txn));
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Suggested categories for the frontend dropdown */
export const SUGGESTED_CATEGORIES = [
  "ai-agent",
  "defi",
  "nft",
  "analytics",
  "oracle",
  "utility",
  "infrastructure",
  "social",
  "gaming",
  "other",
] as const;
