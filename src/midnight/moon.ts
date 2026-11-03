/** Mean synodic month in days. */
const SYNODIC_MONTH = 29.530588853;
/** A known new moon: 2000-01-06 18:14 UTC. */
const REFERENCE_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

/** 0 = new moon, 0.5 = full moon, back to 1 = new. Accurate to roughly a day, which is plenty for a backdrop. */
export function moonPhase(date: Date = new Date()): number {
  const days = (date.getTime() - REFERENCE_NEW_MOON) / 86_400_000;
  const phase = (days / SYNODIC_MONTH) % 1;
  return phase < 0 ? phase + 1 : phase;
}

/** Fraction of the disc that is lit, 0 to 1. */
export function moonIllumination(phase: number): number {
  return (1 - Math.cos(2 * Math.PI * phase)) / 2;
}

export function isFullMoon(phase: number): boolean {
  return Math.abs(phase - 0.5) < 0.035;
}

export function moonPhaseName(phase: number): string {
  if (phase < 0.03 || phase >= 0.97) return "new moon";
  if (phase < 0.22) return "waxing crescent";
  if (phase < 0.28) return "first quarter";
  if (phase < 0.47) return "waxing gibbous";
  if (phase < 0.53) return "full moon";
  if (phase < 0.72) return "waning gibbous";
  if (phase < 0.78) return "last quarter";
  return "waning crescent";
}

/**
 * SVG path for the lit part of a moon disc of radius r centred on (cx, cy).
 * Waxing moons are lit on the right, waning on the left. The terminator is an
 * ellipse whose x-radius shrinks to 0 at the quarters.
 */
export function litMoonPath(phase: number, cx: number, cy: number, r: number): string {
  const waxing = phase < 0.5;
  const c = Math.cos(2 * Math.PI * phase); // 1 at new, -1 at full
  // Rounded so the quarters give a clean 0 instead of float residue like 2.4e-15
  const rx = Math.round(Math.abs(c) * r * 1000) / 1000;
  const crescent = c > 0;
  const top = `${cx} ${cy - r}`;
  const bottom = `${cx} ${cy + r}`;
  const outerSweep = waxing ? 1 : 0;
  const termSweep = waxing ? (crescent ? 0 : 1) : crescent ? 1 : 0;
  return `M ${top} A ${r} ${r} 0 0 ${outerSweep} ${bottom} A ${rx} ${r} 0 0 ${termSweep} ${top} Z`;
}
