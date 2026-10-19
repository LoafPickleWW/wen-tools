/**
 * Native Post-Quantum Accounts (Algorand consensus v42 / go-algorand 5.0)
 *
 * Unlike the LogicSig-based Falcon accounts in ./falcon.ts, native PQ accounts
 * are authorized by a `pqsig` envelope on the SignedTxn itself:
 *
 *   SignedTxn { pqsig: { sch: "f1", slt: <salt>, pk: <1793 B>, sig: <~1.2 KB> }, txn }
 *
 * - address = SHA-512/256("PQA" || scheme || salt || pk), where salt is the
 *   lowest byte (0..255) whose hash is NOT a valid Ed25519 point.
 * - the Falcon signature covers HashRep(txn) = "TX" || msgpack(txn).
 * - fee = 3 × min fee for Falcon-1024 (min fee + 2 min fees PQ surcharge).
 *
 * No LogicSig, no padding transactions, no wallet co-signing.
 */

import algosdk from "algosdk";
import Falcon from "falcon-signatures";
import { sha512_256 } from "@noble/hashes/sha2.js";
import { falcon1024 } from "@noble/post-quantum/falcon.js";

/** Falcon-1024 scheme tag (protocol.PQSchemeFalcon1024). */
export const PQ_SCHEME_FALCON1024 = "f1";

/** Falcon-1024 PQ surcharge is 2 min fees on top of the base min fee. */
export const PQ_FEE_MULTIPLIER = 3;

export interface NativePQAccount {
  address: string;
  publicKey: string; // hex, 1793 bytes
  secretKey: string; // hex, 2305 bytes
  salt: number;
  /**
   * 25-word Algorand mnemonic of the 32-byte entropy the key was derived from.
   * Absent on printers created before recovery phrases existed (random keys).
   */
  mnemonic?: string;
}

// ---------------------------------------------------------------------------
// Falcon WASM singleton
// ---------------------------------------------------------------------------

let falconInstance: Falcon | null = null;

function getFalcon(): Falcon {
  if (!falconInstance) falconInstance = new Falcon();
  return falconInstance;
}

// ---------------------------------------------------------------------------
// Address derivation
// ---------------------------------------------------------------------------

const P = 2n ** 255n - 19n;

function modPow(base: bigint, exp: bigint): bigint {
  let result = 1n;
  base %= P;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % P;
    base = (base * base) % P;
    exp >>= 1n;
  }
  return result;
}

const ED25519_D = (((-121665n * modPow(121666n, P - 2n)) % P) + P) % P;

/**
 * Mirrors go-algorand's crypto.IsEdwards25519Point (filippo.io/edwards25519
 * SetBytes): the point decodes iff x² = (y² − 1) / (d·y² + 1) has a square
 * root mod p. Non-canonical y encodings are accepted, as in the Go decoder.
 */
function isEdwards25519Point(bytes: Uint8Array): boolean {
  let y = 0n;
  for (let i = 31; i >= 0; i--) {
    y = (y << 8n) | BigInt(i === 31 ? bytes[i] & 0x7f : bytes[i]);
  }
  y %= P;
  const y2 = (y * y) % P;
  const u = (y2 - 1n + P) % P;
  const v = (ED25519_D * y2 + 1n) % P;
  const x2 = (u * modPow(v, P - 2n)) % P;
  return x2 === 0n || modPow(x2, (P - 1n) / 2n) === 1n;
}

/**
 * Derive the canonical native PQ address for a Falcon-1024 public key.
 */
export function deriveNativePQAddress(publicKey: Uint8Array): {
  address: string;
  salt: number;
} {
  const prefix = new TextEncoder().encode("PQA" + PQ_SCHEME_FALCON1024);
  for (let salt = 0; salt <= 255; salt++) {
    const preimage = new Uint8Array(prefix.length + 1 + publicKey.length);
    preimage.set(prefix, 0);
    preimage[prefix.length] = salt;
    preimage.set(publicKey, prefix.length + 1);
    const hash = sha512_256(preimage);
    if (!isEdwards25519Point(hash)) {
      return { address: algosdk.encodeAddress(hash), salt };
    }
  }
  throw new Error("No canonical PQ address salt exists for this public key");
}

// ---------------------------------------------------------------------------
// Accounts & signing
// ---------------------------------------------------------------------------

/**
 * Generate a fresh native Falcon-1024 account entirely in the browser.
 */
export async function generateNativePQAccount(): Promise<NativePQAccount> {
  return nativePQAccountFromEntropy(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * Re-create a printer account from its 25-word recovery phrase.
 * Throws on an invalid phrase (bad word or checksum).
 */
export function nativePQAccountFromMnemonic(mnemonic: string): NativePQAccount {
  const words = mnemonic.trim().toLowerCase().split(/\s+/).join(" ");
  return nativePQAccountFromEntropy(algosdk.seedFromMnemonic(words));
}

/**
 * Falcon-1024 account from 32 bytes of entropy, using go-algorand's derivation
 * (cmd/algokey, pinned by its known-answer test), so the same 25 words work
 * with `algokey pq import`:
 *
 *   seed = SHA-512/256("PQK" || "f1" || entropy)
 *   key  = deterministic Falcon-1024 keygen seeded with SHAKE256(seed)
 *
 * Keygen uses @noble/post-quantum, patched to accept Algorand's 32-byte seed
 * (patches/@noble__post-quantum@0.7.1.patch). The keys use the standard Falcon
 * encodings, so signing still goes through the falcon-signatures WASM.
 */
function nativePQAccountFromEntropy(entropy: Uint8Array): NativePQAccount {
  const prefix = new TextEncoder().encode("PQK" + PQ_SCHEME_FALCON1024);
  const seed = sha512_256(new Uint8Array([...prefix, ...entropy]));
  const { publicKey, secretKey } = falcon1024.keygen(seed);
  const { address, salt } = deriveNativePQAddress(publicKey);
  return {
    address,
    publicKey: Falcon.bytesToHex(publicKey),
    secretKey: Falcon.bytesToHex(secretKey),
    salt,
    mnemonic: algosdk.mnemonicFromSeed(entropy),
  };
}

export interface NativePQSignedTxn {
  txID: string;
  blob: Uint8Array;
  signatureBytes: number;
}

/**
 * Sign a transaction with a native PQ account and wrap it in a `pqsig` envelope.
 */
export async function signNativePQTransaction(
  txn: algosdk.Transaction,
  account: NativePQAccount,
  /** Optional off-thread signer (e.g. a worker pool) holding the same key. */
  signer?: (message: Uint8Array) => Promise<Uint8Array>,
): Promise<NativePQSignedTxn> {
  const message = txn.bytesToSign();
  const signature = signer
    ? await signer(message)
    : await getFalcon().sign(message, Falcon.hexToBytes(account.secretKey));

  // Canonical msgpack: zero-valued fields (salt 0) are omitted.
  const pqsig: Record<string, unknown> = {
    pk: Falcon.hexToBytes(account.publicKey),
    sch: new TextEncoder().encode(PQ_SCHEME_FALCON1024),
    sig: signature,
  };
  if (account.salt !== 0) pqsig.slt = account.salt;

  return {
    txID: txn.txID().toString(),
    blob: algosdk.msgpackRawEncode({ pqsig, txn: algosdk.msgpackRawDecode(algosdk.encodeUnsignedTransaction(txn)) }),
    signatureBytes: signature.length,
  };
}

/** Fee for one Falcon-1024 authorized transaction, in microAlgos. */
export function nativePQFee(minFee: number): number {
  return PQ_FEE_MULTIPLIER * minFee;
}
