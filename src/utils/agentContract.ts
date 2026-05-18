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
  mainnet: Number(import.meta.env.VITE_FACTORY_APP_ID_MAINNET || 3562772718),
  testnet: Number(import.meta.env.VITE_FACTORY_APP_ID_TESTNET || 762783309),
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

// ─── Global state decoder ────────────────────────────────────────────────────

function decodeStateValue(sv: { type: number; bytes?: string; uint?: number }): string | number {
  if (sv.type === 1) {
    // bytes → UTF-8 string
    return atob(sv.bytes || "");
  }
  return sv.uint ?? 0;
}

function decodeGlobalState(
  appId: number,
  state: Array<{ key: string; value: { type: number; bytes?: string; uint?: number } }>
): AgentListing {
  const kv: Record<string, string | number> = {};
  for (const entry of state) {
    const key = atob(entry.key);
    kv[key] = decodeStateValue(entry.value);
  }

  const priceRaw = typeof kv["price_algo"] === "number" ? kv["price_algo"] : 0;

  return {
    appId,
    name: (kv["name"] as string) || "",
    description: (kv["description"] as string) || "",
    endpointUrl: (kv["endpoint_url"] as string) || "",
    pricePerCallAlgo: priceRaw / 1_000_000,
    category: (kv["category"] as string) || "other",
    walletAddress: (kv["wallet_address"] as string) || "",
    active: kv["active"] === 1,
    x402Compatible: false, // Will be determined by endpoint probing in the future
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
        // Read box value (child app ID as uint64)
        const boxRes = await algod
          .getApplicationBoxByName(factoryId, new Uint8Array(Buffer.from(box.name, "base64")))
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

        const listing = decodeGlobalState(childAppId, globalState);
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

/**
 * Check if a wallet already has a listing registered.
 */
export async function getListingByWallet(
  address: string,
  network: NetworkId
): Promise<AgentListing | null> {
  const factoryId = getFactoryAppId(network);
  if (!factoryId) return null;

  const algod = getAlgodClient(network);
  const indexerBase = getIndexerBase(network);

  try {
    // Read the box for this wallet address
    const addrBytes = algosdk.decodeAddress(address).publicKey;
    const boxRes = await algod
      .getApplicationBoxByName(factoryId, addrBytes)
      .do();

    const view = new DataView(new Uint8Array(boxRes.value).buffer);
    const childAppId = Number(view.getBigUint64(0));

    if (childAppId === 0) return null;

    // Read child global state
    const appRes = await fetch(
      `${indexerBase}/v2/applications/${childAppId}`
    );
    if (!appRes.ok) return null;
    const appData = await appRes.json();
    const globalState = appData.application?.params?.["global-state"];
    if (!globalState) return null;

    return decodeGlobalState(childAppId, globalState);
  } catch {
    return null;
  }
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
  const suggestedParams = await algod.getTransactionParams().do();

  const mbrPayment = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: senderAddress,
    to: algosdk.getApplicationAddress(factoryId),
    amount: 425_500, // Box MBR (18.5k) + Child App MBR (407k)
    suggestedParams,
  });

  const priceMicro = Math.round(params.priceAlgo * 1_000_000);

  const atc = new algosdk.AtomicTransactionComposer();
  const dummySigner = async () => [];

  atc.addMethodCall({
    appID: factoryId,
    method: algosdk.ABIMethod.fromSignature("create_listing(pay,string,string,string,uint64,string)uint64"),
    methodArgs: [
      { txn: mbrPayment, signer: dummySigner },
      params.name,
      params.description,
      params.endpointUrl,
      priceMicro,
      params.category
    ],
    sender: senderAddress,
    suggestedParams: { ...suggestedParams, fee: 2000, flatFee: true },
    signer: dummySigner,
    boxes: [{ appIndex: factoryId, name: algosdk.decodeAddress(senderAddress).publicKey }],
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
    method: algosdk.ABIMethod.fromSignature("update_listing(string,string,string,uint64,string)void"),
    methodArgs: [
      params.name,
      params.description,
      params.endpointUrl,
      priceMicro,
      params.category
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
  atc.addMethodCall({
    appID: factoryId,
    method: algosdk.ABIMethod.fromSignature("delete_listing()void"),
    methodArgs: [],
    sender: senderAddress,
    suggestedParams: { ...suggestedParams, fee: 2000, flatFee: true }, // Inner txn fee coverage
    signer: dummySigner,
    boxes: [{ appIndex: factoryId, name: algosdk.decodeAddress(senderAddress).publicKey }],
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
