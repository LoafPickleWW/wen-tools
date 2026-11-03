import { bech32Encode, convertBits, hexToBytes } from "./bech32";

/** The slice of the CIP-30 wallet API this site uses. All values are hex-encoded CBOR/bytes. */
export interface Cip30Api {
  getNetworkId(): Promise<number>;
  getUsedAddresses(): Promise<string[]>;
  getChangeAddress(): Promise<string>;
  signTx(tx: string, partialSign?: boolean): Promise<string>;
  submitTx(tx: string): Promise<string>;
}

export interface Cip30Wallet {
  /** Key under window.cardano */
  key: string;
  name: string;
  icon: string;
  enable(): Promise<Cip30Api>;
}

/** Wallets we list first, in this order, when several are installed. */
const PREFERRED = ["1am", "lace"];

export function discoverCip30Wallets(): Cip30Wallet[] {
  const injected = (window as unknown as { cardano?: Record<string, unknown> }).cardano;
  if (!injected) return [];
  const found = Object.entries(injected)
    .filter(([, v]) => v && typeof (v as { enable?: unknown }).enable === "function")
    .map(([key, v]) => {
      const w = v as { name?: string; icon?: string; enable: () => Promise<Cip30Api> };
      return { key, name: w.name ?? key, icon: w.icon ?? "", enable: () => w.enable() };
    });
  const rank = (k: string) => {
    const i = PREFERRED.indexOf(k.toLowerCase());
    return i === -1 ? PREFERRED.length : i;
  };
  // Wallets often register an alias under a second key (e.g. cardano.app); keep one per name
  const seen = new Set<string>();
  return found
    .sort((a, b) => rank(a.key) - rank(b.key))
    .filter((w) => !seen.has(w.name) && !!seen.add(w.name));
}

/**
 * CIP-30 returns addresses as raw bytes in hex. DexHunter wants bech32. Only mainnet payment
 * addresses are accepted: header type 0-7, network nibble 1.
 */
export function addressHexToBech32(hex: string): string {
  const bytes = hexToBytes(hex);
  if (bytes.length < 29) throw new Error("Unexpected address from wallet");
  const type = bytes[0] >> 4;
  const network = bytes[0] & 0x0f;
  if (type > 7) throw new Error("Unsupported address type");
  if (network !== 1) throw new Error("Switch your Cardano wallet to mainnet");
  return bech32Encode("addr", convertBits(bytes, 8, 5, true));
}

/** Enables the wallet, checks it is on mainnet, and returns its API with the address to buy with. */
export async function connectCip30(wallet: Cip30Wallet): Promise<{ api: Cip30Api; address: string }> {
  const api = await wallet.enable();
  if ((await api.getNetworkId()) !== 1) throw new Error("Switch your Cardano wallet to mainnet");
  const used = await api.getUsedAddresses().catch(() => [] as string[]);
  const hex = used[0] ?? (await api.getChangeAddress());
  return { api, address: addressHexToBech32(hex) };
}
