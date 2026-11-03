/**
 * Minimal bech32 (BIP-173), enough to turn a CIP-30 wallet's hex address into addr1... for
 * DexHunter. Cardano addresses exceed bech32's 90-character limit, so that limit is not enforced.
 */
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GENERATORS[i];
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

/** Regroups bits, e.g. 8-bit bytes into 5-bit words (pad = true) or back (pad = false). */
export function convertBits(data: number[], from: number, to: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from !== 0) throw new Error("Invalid value for bit conversion");
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
    acc &= (1 << bits) - 1;
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv) !== 0) {
    throw new Error("Invalid padding");
  }
  return out;
}

export function bech32Encode(hrp: string, words: number[]): string {
  const checksum = polymod([...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const check = Array.from({ length: 6 }, (_, i) => (checksum >> (5 * (5 - i))) & 31);
  return `${hrp}1${[...words, ...check].map((w) => CHARSET[w]).join("")}`;
}

export function bech32Decode(str: string): { hrp: string; words: number[] } {
  const lower = str.toLowerCase();
  if (lower !== str && str.toUpperCase() !== str) throw new Error("Mixed-case bech32");
  const sep = lower.lastIndexOf("1");
  if (sep < 1 || sep + 7 > lower.length) throw new Error("Invalid bech32");
  const hrp = lower.slice(0, sep);
  const data = [...lower.slice(sep + 1)].map((c) => {
    const i = CHARSET.indexOf(c);
    if (i === -1) throw new Error("Invalid bech32 character");
    return i;
  });
  if (polymod([...hrpExpand(hrp), ...data]) !== 1) throw new Error("Invalid bech32 checksum");
  return { hrp, words: data.slice(0, -6) };
}

export function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): number[] {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) throw new Error("Invalid hex");
  return hex.match(/../g)!.map((h) => parseInt(h, 16));
}
