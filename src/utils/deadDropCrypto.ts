import nacl from "tweetnacl";

/**
 * Derives a X25519 keypair from an Algorand transaction signature.
 * Used during mailbox initialization to create a persistent messaging identity.
 */
export function deriveKeyFromSignature(signature: Uint8Array): nacl.BoxKeyPair {
  const seed = nacl.hash(signature).slice(0, 32);
  return nacl.box.keyPair.fromSecretKey(seed);
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
