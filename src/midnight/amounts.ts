import { MidnightKind, NIGHT_DECIMALS, NIGHT_TOKEN_TYPE, TokenType } from "./types";

/** NIGHT has 6 decimals; other token types carry no decimals metadata, so they are raw units. */
export function decimalsFor(type: TokenType): number {
  return type === NIGHT_TOKEN_TYPE ? NIGHT_DECIMALS : 0;
}

export function tokenLabel(type: TokenType): string {
  return type === NIGHT_TOKEN_TYPE ? "NIGHT" : `${type.slice(0, 6)}…${type.slice(-4)}`;
}

/** "1.5" with 6 decimals -> 1_500_000n. Throws on malformed or over-precise input. */
export function parseUnits(value: string, decimals: number): bigint {
  const v = value.trim();
  if (!/^\d+(\.\d+)?$/.test(v)) throw new Error(`"${value}" is not a valid amount`);
  const [whole, frac = ""] = v.split(".");
  if (frac.length > decimals) {
    throw new Error(`"${value}" has more than ${decimals} decimal places`);
  }
  return BigInt(whole + frac.padEnd(decimals, "0"));
}

export function formatUnits(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString();
  const s = value.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * The connector reports DUST in SPECK. 1 DUST = 10^15 SPECK, derived from the documented
 * nightDustRatio (5e9 SPECK per STAR) giving a 5 DUST cap per NIGHT at 10^6 STAR per NIGHT.
 */
export const DUST_DECIMALS = 15;

/** DUST for display: SPECK converted and cut to 4 decimals (cut, not rounded, so it never overstates). */
export function formatDust(speck: bigint): string {
  const [whole, frac = ""] = formatUnits(speck, DUST_DECIMALS).split(".");
  const short = frac.slice(0, 4).replace(/0+$/, "");
  return short ? `${whole}.${short}` : whole;
}

const ADDRESS_PREFIX: Record<MidnightKind, RegExp> = {
  unshielded: /^mn_addr(_[a-z0-9]+)?1[0-9a-z]{20,}$/,
  shielded: /^mn_shield-addr(_[a-z0-9]+)?1[0-9a-z]{20,}$/,
};

/** Cheap shape check so obvious mistakes fail before the wallet prompt; the wallet does the real validation. */
export function isMidnightAddress(address: string, kind: MidnightKind): boolean {
  return ADDRESS_PREFIX[kind].test(address);
}

export interface ParsedRecipient {
  recipient: string;
  value: bigint;
  line: number;
}

/**
 * One recipient per line: `address` (uses defaultAmount) or `address,amount`.
 * Collects every problem instead of stopping at the first.
 */
export function parseRecipients(
  text: string,
  kind: MidnightKind,
  decimals: number,
  defaultAmount: string,
): { recipients: ParsedRecipient[]; errors: string[] } {
  const recipients: ParsedRecipient[] = [];
  const errors: string[] = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const [address, amount] = line.split(/[,\s]+/).filter(Boolean);
    const lineNo = i + 1;
    if (!isMidnightAddress(address, kind)) {
      errors.push(`Line ${lineNo}: not a valid ${kind} address`);
      return;
    }
    try {
      const value = parseUnits(amount ?? defaultAmount, decimals);
      if (value <= 0n) throw new Error("amount must be greater than 0");
      recipients.push({ recipient: address, value, line: lineNo });
    } catch (e) {
      errors.push(`Line ${lineNo}: ${(e as Error).message}`);
    }
  });
  return { recipients, errors };
}
