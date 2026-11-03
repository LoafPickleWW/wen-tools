import { describe, expect, it } from "vitest";
import { isFullMoon, litMoonPath, moonIllumination, moonPhase, moonPhaseName } from "../src/midnight/moon";

describe("moonPhase", () => {
  it("is new at the reference new moon", () => {
    const p = moonPhase(new Date(Date.UTC(2000, 0, 6, 18, 14)));
    expect(Math.min(p, 1 - p)).toBeLessThan(0.01);
  });

  it("is full on a known full moon (2024-01-25 17:54 UTC)", () => {
    const p = moonPhase(new Date(Date.UTC(2024, 0, 25, 17, 54)));
    expect(p).toBeGreaterThan(0.48);
    expect(p).toBeLessThan(0.52);
    expect(isFullMoon(p)).toBe(true);
    expect(moonPhaseName(p)).toBe("full moon");
  });

  it("stays within [0, 1) for dates before the reference", () => {
    const p = moonPhase(new Date(Date.UTC(1990, 5, 1)));
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(1);
  });
});

describe("moonIllumination", () => {
  it("is 0 at new, 0.5 at the quarters and 1 at full", () => {
    expect(moonIllumination(0)).toBeCloseTo(0);
    expect(moonIllumination(0.25)).toBeCloseTo(0.5);
    expect(moonIllumination(0.5)).toBeCloseTo(1);
    expect(moonIllumination(0.75)).toBeCloseTo(0.5);
  });
});

describe("litMoonPath", () => {
  it("lights the right side when waxing and the left when waning", () => {
    expect(litMoonPath(0.25, 50, 50, 40)).toContain("A 40 40 0 0 1");
    expect(litMoonPath(0.75, 50, 50, 40)).toContain("A 40 40 0 0 0");
  });

  it("flattens the terminator to a straight line at the quarters", () => {
    expect(litMoonPath(0.25, 50, 50, 40)).toContain("A 0 40");
  });
});
