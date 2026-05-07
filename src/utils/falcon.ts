/**
 * Falcon Post-Quantum Utilities
 *
 * Wraps the `falcon-signatures` and `falcon-algo-sdk` npm packages.
 * Every crypto operation runs client-side in WASM — no keys ever leave the browser.
 *
 * Install:
 *   pnpm add falcon-signatures falcon-algo-sdk
 */

import Falcon from "falcon-signatures";
import FalconAlgoSDK, { Networks } from "falcon-algo-sdk";
import algosdk from "algosdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FalconKeypair {
  publicKey: string; // hex
  secretKey: string; // hex
}

export interface FalconAccount {
  id?: number; // Dexie auto-increment
  label: string;
  address: string; // Algorand LogicSig address
  publicKey: string; // hex
  secretKey: string; // hex (plaintext) or ciphertext hex (if encrypted)
  createdAt: number; // epoch ms
  network: "mainnet" | "testnet" | "betanet";
  /** Raw account info object returned by the SDK (JSON-serialised) */
  sdkAccountInfo: string;
  /** Whether the secret key is encrypted with a passphrase */
  encrypted?: boolean;
  /** PBKDF2 salt (hex) — present when encrypted */
  salt?: string;
  /** AES-GCM IV (hex) — present when encrypted */
  iv?: string;
}

export interface SendParams {
  receiver: string;
  amount: number; // microAlgos
  note?: string;
}

export type NetworkName = "mainnet" | "testnet" | "betanet";

// ---------------------------------------------------------------------------
// Singleton Falcon WASM instance
// ---------------------------------------------------------------------------

let falconInstance: Falcon | null = null;

async function getFalcon(): Promise<Falcon> {
  if (!falconInstance) {
    falconInstance = new Falcon();
  }
  return falconInstance;
}

// ---------------------------------------------------------------------------
// SDK helpers
// ---------------------------------------------------------------------------

function getNetworkConfig(network: NetworkName) {
  switch (network) {
    case "mainnet":
      return Networks.MAINNET;
    case "betanet":
      return Networks.BETANET;
    case "testnet":
    default:
      return Networks.TESTNET;
  }
}

function getSdk(network: NetworkName) {
  return new FalconAlgoSDK(getNetworkConfig(network));
}

function getAlgod(network: NetworkName) {
  const urls: Record<NetworkName, string> = {
    mainnet: "https://mainnet-api.algonode.cloud",
    testnet: "https://testnet-api.algonode.cloud",
    betanet: "https://betanet-api.algonode.cloud",
  };
  return new algosdk.Algodv2("", urls[network], "");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a fresh Falcon-1024 keypair (client-side WASM).
 */
export async function generateKeypair(): Promise<FalconKeypair> {
  const falcon = await getFalcon();
  const { publicKey, secretKey } = await falcon.keypair();
  return {
    publicKey: Falcon.bytesToHex(publicKey),
    secretKey: Falcon.bytesToHex(secretKey),
  };
}

/**
 * Create a new Falcon-protected Algorand account.
 * Returns the full account object ready to persist in IndexedDB.
 */
export async function createAccount(
  network: NetworkName = "testnet",
  label?: string,
): Promise<FalconAccount> {
  const sdk = getSdk(network);
  const accountInfo = await sdk.createFalconAccount();

  return {
    label: label || `Falcon ${new Date().toLocaleDateString()}`,
    address: accountInfo.address,
    publicKey: accountInfo.falconKeys.publicKey,
    secretKey: accountInfo.falconKeys.secretKey,
    createdAt: Date.now(),
    network,
    sdkAccountInfo: JSON.stringify(accountInfo, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
  };
}

/**
 * Fetch the Algo balance (in microAlgos) for a given address.
 */
export async function getBalance(
  address: string,
  network: NetworkName = "testnet",
): Promise<number> {
  try {
    const algod = getAlgod(network);
    const info = await algod.accountInformation(address).do();
    // algosdk v2/v3 may return bigint or number
    const amt = (info as any).amount ?? (info as any)["amount"];
    return Number(amt);
  } catch {
    return 0;
  }
}

/**
 * Send Algo from a Falcon-protected account.
 * Returns the confirmed transaction ID.
 */
export async function sendTransaction(
  account: FalconAccount,
  params: SendParams,
): Promise<string> {
  const sdk = getSdk(account.network);
  const accountInfo = JSON.parse(account.sdkAccountInfo);

  // Re-hydrate falcon keys (in case the SDK needs them fresh)
  accountInfo.falconKeys = {
    publicKey: account.publicKey,
    secretKey: account.secretKey,
  };

  const payment = await sdk.createPayment(
    {
      sender: account.address,
      receiver: params.receiver,
      amount: params.amount,
      note: params.note || "",
    },
    accountInfo,
  );

  // Submit to network
  const algod = getAlgod(account.network);
  const result = await algod.sendRawTransaction(payment.blob).do();
  const txId = (result as any).txId ?? (result as any).txid ?? (result as any)["txId"];
  return txId;
}

/**
 * Export account data as a JSON string for the user to download.
 * Contains everything needed to restore the account.
 */
export function exportAccount(account: FalconAccount): string {
  const exportData = {
    version: 1,
    label: account.label,
    address: account.address,
    publicKey: account.publicKey,
    secretKey: account.secretKey,
    network: account.network,
    createdAt: account.createdAt,
    sdkAccountInfo: account.sdkAccountInfo,
  };
  return JSON.stringify(exportData, null, 2);
}

/**
 * Parse an imported JSON string back into a FalconAccount.
 * Throws if the format is invalid.
 */
export function importAccount(json: string): FalconAccount {
  const data = JSON.parse(json);
  if (!data.address || !data.publicKey || !data.secretKey) {
    throw new Error(
      "Invalid backup file. Must contain address, publicKey, and secretKey.",
    );
  }
  return {
    label: data.label || `Imported ${new Date().toLocaleDateString()}`,
    address: data.address,
    publicKey: data.publicKey,
    secretKey: data.secretKey,
    createdAt: data.createdAt || Date.now(),
    network: data.network || "testnet",
    sdkAccountInfo: data.sdkAccountInfo || "{}",
    encrypted: data.encrypted || false,
    salt: data.salt,
    iv: data.iv,
  };
}

/**
 * Format microAlgos → human-readable Algo string.
 */
export function microAlgosToAlgos(microAlgos: number): string {
  return (microAlgos / 1_000_000).toFixed(6);
}

/**
 * Parse a user-entered Algo string → microAlgos.
 */
export function algosToMicroAlgos(algos: string | number): number {
  return Math.floor(Number(algos) * 1_000_000);
}

/**
 * Explorer link for a transaction.
 */
export function getExplorerTxUrl(
  txId: string,
  network: NetworkName = "testnet",
): string {
  return `https://lora.algokit.io/${network}/transaction/${txId}`;
}

/**
 * Explorer link for an address.
 */
export function getExplorerAddressUrl(
  address: string,
  network: NetworkName = "testnet",
): string {
  return `https://lora.algokit.io/${network}/account/${address}`;
}

// ---------------------------------------------------------------------------
// Passphrase encryption (PBKDF2 + AES-256-GCM)
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHexLocal(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a hex-encoded secret key with a user passphrase.
 */
export async function encryptSecretKey(
  secretKeyHex: string,
  passphrase: string,
): Promise<{ ciphertext: string; salt: string; iv: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(secretKeyHex),
  );
  return {
    ciphertext: bytesToHexLocal(new Uint8Array(encrypted)),
    salt: bytesToHexLocal(salt),
    iv: bytesToHexLocal(iv),
  };
}

/**
 * Decrypt a passphrase-protected secret key back to hex.
 * Throws if the passphrase is wrong.
 */
export async function decryptSecretKey(
  ciphertext: string,
  passphrase: string,
  salt: string,
  iv: string,
): Promise<string> {
  const key = await deriveKey(passphrase, hexToBytes(salt));
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: hexToBytes(iv) },
    key,
    hexToBytes(ciphertext),
  );
  return new TextDecoder().decode(decrypted);
}

/**
 * Return a copy of the account with its secret key decrypted.
 * If the account isn't encrypted, returns it as-is.
 */
export async function getDecryptedAccount(
  account: FalconAccount,
  passphrase: string,
): Promise<FalconAccount> {
  if (!account.encrypted || !account.salt || !account.iv) {
    return account;
  }
  const secretKey = await decryptSecretKey(
    account.secretKey,
    passphrase,
    account.salt,
    account.iv,
  );
  return { ...account, secretKey, encrypted: false };
}
