/**
 * Version-independent views of transactions. Everything here goes through the msgpack
 * wire encoding (the protocol format), never through algosdk's object shape, so a
 * snapshot taken on algosdk v2 must match byte-for-byte on v3.
 */
import * as algosdk from "algosdk";
import { decode as mpDecode } from "@msgpack/msgpack";

export const b64 = (u: Uint8Array) => {
  let s = "";
  for (const c of u) s += String.fromCharCode(c);
  return btoa(s);
};

export const addr = (u: Uint8Array) => algosdk.encodeAddress(u);

const ADDRESS_KEYS = new Set(["snd", "rcv", "close", "asnd", "arcv", "aclose", "fadd", "rekey", "m", "r", "f", "c", "sgnr"]);

const printable = (u: Uint8Array) => {
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(u);
    return /^[\x20-\x7E\u00A0-\uFFFF\n\r\t]*$/.test(s) ? s : null;
  } catch {
    return null;
  }
};

function normalize(value: any, key = ""): any {
  if (value instanceof Uint8Array) {
    if (value.length === 32 && ADDRESS_KEYS.has(key)) return `addr:${addr(value)}`;
    if (key === "note" || key === "apaa" || key === "an" || key === "un" || key === "au" || key === "n") {
      const s = printable(value);
      if (s !== null) return `utf8:${s}`;
    }
    return `b64:${b64(value)}`;
  }
  if (typeof value === "bigint" || typeof value === "number") return `int:${value.toString()}`;
  if (Array.isArray(value)) {
    if (key === "apat") return value.map((v) => normalize(v, "snd"));
    return value.map((v) => normalize(v, key === "apaa" ? "apaa" : ""));
  }
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value).sort()) out[k] = normalize(value[k], k);
    return out;
  }
  return value;
}

/** Canonical msgpack bytes of an unsigned transaction. */
export const txnBytes = (txn: algosdk.Transaction) => algosdk.encodeUnsignedTransaction(txn);

/** Wire-level fields of a transaction, plus its txID. */
export function wire(txn: algosdk.Transaction) {
  const raw = mpDecode(txnBytes(txn), { useBigInt64: true }) as any;
  return { txID: txn.txID().toString(), ...normalize(raw) };
}

/** Wire-level view of signed txn bytes (as produced by a signer or sent to algod). */
export function wireSigned(bytes: Uint8Array) {
  const raw = mpDecode(bytes, { useBigInt64: true }) as any;
  const stxn = algosdk.decodeSignedTransaction(bytes);
  return { txID: stxn.txn.txID().toString(), ...normalize(raw) };
}

/** Normalize an already-decoded raw msgpack object. */
export const wireRaw = (raw: any) => normalize(raw);

/** Deep-convert any value into a snapshot-friendly form that keeps number vs bigint visible. */
export function plain(value: any): any {
  if (value instanceof Uint8Array) return `bytes:${b64(value)}`;
  if (typeof value === "bigint") return `${value}n`;
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") {
    if (typeof value.toString === "function" && value.constructor?.name === "Address") return `Address(${value.toString()})`;
    const out: Record<string, any> = {};
    for (const k of Object.keys(value)) out[k] = plain(value[k]);
    return out;
  }
  return value;
}
