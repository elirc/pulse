import { describe, it, expect } from "vitest";
import { estimateFromSample, MIN_RELIABLE_OBSERVED } from "./sampling";
import { cardinalityGuard, HIGH_CARDINALITY_THRESHOLD, GUARDED_TOP_N } from "./cardinality-guard";

/**
 * Property-style evals (S12) for the two numeric guards. Golden fixtures pin known answers; these assert the
 * INVARIANTS that must hold across a swept input range — the properties that a future refactor must not break.
 */

// A tiny deterministic PRNG so the "random" sweep is reproducible in CI.
function* lcg(seed: number, n: number): Generator<number> {
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    yield s / 0xffffffff;
  }
}

describe("sampling CI math — invariants (S12)", () => {
  it("estimate ≈ observed / rate, and the CI is never negative", () => {
    for (const r of lcg(1, 200)) {
      const observed = Math.floor(r * 100_000);
      const rate = 0.01 + r * 0.5; // 0.01..0.51
      const e = estimateFromSample(observed, rate);
      expect(e.estimate).toBe(Math.round(observed / rate));
      expect(e.ci95).toBeGreaterThanOrEqual(0);
      expect(e.relativeCi).toBeGreaterThanOrEqual(0);
    }
  });

  it("relative CI is monotonic non-increasing as observed grows (more data → more certainty)", () => {
    const rate = 0.1;
    let prev = Infinity;
    for (let observed = 40; observed <= 100_000; observed *= 2) {
      const rel = estimateFromSample(observed, rate).relativeCi;
      expect(rel).toBeLessThanOrEqual(prev + 1e-9);
      prev = rel;
    }
  });

  it("reliability flips exactly at the observed floor", () => {
    expect(estimateFromSample(MIN_RELIABLE_OBSERVED - 1, 0.1).reliable).toBe(false);
    expect(estimateFromSample(MIN_RELIABLE_OBSERVED, 0.1).reliable).toBe(true);
    expect(estimateFromSample(MIN_RELIABLE_OBSERVED + 1, 0.1).reliable).toBe(true);
  });

  it("a zero-observed sample has a zero estimate and no relative CI (no divide-by-zero)", () => {
    const e = estimateFromSample(0, 0.1);
    expect(e.estimate).toBe(0);
    expect(e.relativeCi).toBe(0);
    expect(e.reliable).toBe(false);
  });
});

describe("cardinality guard — invariants (S12)", () => {
  it("never raises the requested top-N; only ever caps it", () => {
    for (const r of lcg(7, 200)) {
      const distinct = Math.floor(r * 100_000);
      const requested = 1 + Math.floor(r * 500);
      const g = cardinalityGuard("p", distinct, requested);
      expect(g.effectiveTopN).toBeLessThanOrEqual(requested);
      if (g.guarded) expect(g.effectiveTopN).toBeLessThanOrEqual(GUARDED_TOP_N);
    }
  });

  it("guards iff distinct strictly exceeds the threshold", () => {
    expect(cardinalityGuard("p", HIGH_CARDINALITY_THRESHOLD, 50).guarded).toBe(false); // exactly at limit
    expect(cardinalityGuard("p", HIGH_CARDINALITY_THRESHOLD + 1, 50).guarded).toBe(true);
  });

  it("a guarded result always carries a notice that names the property and the effective top-N", () => {
    const g = cardinalityGuard("$url", 50_000, 200);
    expect(g.guarded).toBe(true);
    expect(g.notice).toContain("$url");
    expect(g.notice).toContain(String(g.effectiveTopN));
  });

  it("respects a smaller requested top-N even when guarding (min, not clobber)", () => {
    const g = cardinalityGuard("p", 50_000, 5);
    expect(g.effectiveTopN).toBe(5); // min(5, 20) = 5
  });
});
