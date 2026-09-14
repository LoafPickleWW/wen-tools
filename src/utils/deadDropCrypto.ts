import nacl from "tweetnacl";
import algosdk from "algosdk";
import { convertPublicKey } from "ed2curve";



/**
 * Derives a X25519 keypair from an Algorand transaction signature.
 * Used during mailbox initialization to create a persistent messaging identity.
 */
export function deriveKeyFromSignature(signature: Uint8Array): nacl.BoxKeyPair {
  const seed = nacl.hash(signature).slice(0, 32);
  return nacl.box.keyPair.fromSecretKey(seed);
}

/**
 * Safely extracts signature bytes from a decoded Algorand SignedTransaction object.
 * Supports standard Ed25519 (.sig), Consensus v42 Post-Quantum (.pqsig), LogicSig (.lsig), and Multisig (.msig).
 */
export function extractSignatureBytes(decodedTxn: any): Uint8Array | null {
  if (!decodedTxn) return null;

  // 1. Native Consensus v42 Post-Quantum (PQSIG) signature from Pera / Lute / v42 wallets
  if (decodedTxn.pqsig) {
    if (decodedTxn.pqsig instanceof Uint8Array) {
      return decodedTxn.pqsig;
    }
    if (decodedTxn.pqsig.sig instanceof Uint8Array) {
      return decodedTxn.pqsig.sig;
    }
    if (typeof decodedTxn.pqsig === "string") {
      return base64ToUint8(decodedTxn.pqsig);
    }
    try {
      return nacl.hash(algosdk.encodeObj(decodedTxn.pqsig));
    } catch {
      // fallback
    }
  }

  // 2. Standard Ed25519 signature
  if (decodedTxn.sig instanceof Uint8Array && decodedTxn.sig.length > 0) {
    return decodedTxn.sig;
  }

  // 3. LogicSig signature (e.g. WASM Falcon LogicSig)
  if (decodedTxn.lsig) {
    if (Array.isArray(decodedTxn.lsig.arg) && decodedTxn.lsig.arg[0] instanceof Uint8Array) {
      return decodedTxn.lsig.arg[0];
    }
    if (decodedTxn.lsig.logic instanceof Uint8Array) {
      return nacl.hash(decodedTxn.lsig.logic);
    }
  }

  // 4. Multisig
  if (decodedTxn.msig) {
    try {
      return nacl.hash(algosdk.encodeObj(decodedTxn.msig));
    } catch {
      // fallback
    }
  }

  return null;
}

/**
 * Encrypts a text payload for a recipient using their registered X25519 public key.
 * The recipientPubKeyB64 MUST be an X25519 key (from the relay registry or NFD).
 * Using a raw Algorand Ed25519 key here will produce undecryptable output.
 */
export async function encryptDeadDrop(
  message: string,
  recipientAddress: string,
  recipientPubKeyB64?: string
) {
  if (!recipientPubKeyB64) {
    throw new Error("Recipient public key is required for encryption. The recipient must initialize their mailbox first.");
  }
  const recipientPk = base64ToUint8(recipientPubKeyB64);

  const ephemeralKeyPair = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const messageUint8 = new TextEncoder().encode(message);
  
  const ciphertext = nacl.box(
    messageUint8,
    nonce,
    recipientPk, 
    ephemeralKeyPair.secretKey
  );

  return {
    ciphertext: uint8ToBase64(ciphertext),
    nonce: uint8ToBase64(nonce),
    ephemeralPk: uint8ToBase64(ephemeralKeyPair.publicKey),
    target: recipientAddress
  };
}

export async function fetchNfdEncryptionKey(nfdName: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.nf.domains/nfd/${nfdName.toLowerCase()}?view=full`);
    const data = await res.json();
    // Check user-defined properties for an encryption key
    return data?.properties?.userDefined?.encryption_key || null;
  } catch {
    return null;
  }
}

/**
 * Encrypts a binary payload (like a file) for a recipient using their X25519 public key.
 */
export async function encryptBinaryDeadDrop(
  data: Uint8Array,
  recipientAddress: string,
  recipientPubKeyB64?: string
) {
  if (!recipientPubKeyB64) {
    throw new Error("Recipient public key is required for encryption.");
  }
  const recipientPk = base64ToUint8(recipientPubKeyB64);

  const ephemeralKeyPair = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  
  const ciphertext = nacl.box(
    data,
    nonce,
    recipientPk, 
    ephemeralKeyPair.secretKey
  );

  return {
    ciphertext: uint8ToBase64(ciphertext),
    nonce: uint8ToBase64(nonce),
    ephemeralPk: uint8ToBase64(ephemeralKeyPair.publicKey),
    target: recipientAddress
  };
}

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decrypts a text dead drop using the recipient's secret key.
 */
export function decryptDeadDrop(
  ciphertext: string,
  nonce: string,
  ephemeralPk: string,
  secretKey: Uint8Array
): string {
  const decrypted = nacl.box.open(
    base64ToUint8(ciphertext),
    base64ToUint8(nonce),
    base64ToUint8(ephemeralPk),
    secretKey
  );

  if (!decrypted) throw new Error("Decryption failed");
  return new TextDecoder().decode(decrypted);
}

/**
 * Decrypts a binary dead drop (file).
 */
export function decryptBinaryDeadDrop(
  ciphertext: string,
  nonce: string,
  ephemeralPk: string,
  secretKey: Uint8Array
): Uint8Array {
  const decrypted = nacl.box.open(
    base64ToUint8(ciphertext),
    base64ToUint8(nonce),
    base64ToUint8(ephemeralPk),
    secretKey
  );

  if (!decrypted) throw new Error("Decryption failed");
  return decrypted;
}

/**
 * BEACON Protocol helper
 * Converts an Algorand ed25519 public key directly to an X25519 (curve25519) key for encryption.
 */
export function algoAddressToCurve25519B64(address: string): string {
  const decoded = algosdk.decodeAddress(address);
  const curveKey = convertPublicKey(decoded.publicKey);
  if (!curveKey) throw new Error("Could not convert Algorand address to encryption key");
  return uint8ToBase64(curveKey);
}
