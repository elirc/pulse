import { describe, it, expect } from "vitest";
import { twoProportionZTest, normalCdf, computeExperimentResult } from "./results";

/**
 * A/A simulation as a regression test (S14). The peeking doc's teaching number, pinned: run many A/A experiments
 * (true lift = zero) and assert the FIXED-HORIZON false-positive rate stays near α=5%, while a PEEKER's rate is
 * materially inflated. If a future refactor breaks the z-test math (or the CI), one of these bounds fails.
 * Smaller scale than the doc's 1000× so CI stays fast, but large enough for stable rates.
 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe("A/A simulation — false-positive rates (S14 regression)", () => {
  it("fixed horizon ≈ 5%, peeking materially higher", () => {
    const RATE = 0.1;
    const N = 1500;
    const PEEK = 100;
    const EXPERIMENTS = 600;
    const rnd = lcg(20260711);
    let fixed = 0;
    let peeking = 0;
    for (let e = 0; e < EXPERIMENTS; e++) {
      let a = 0;
      let b = 0;
      let peeked = false;
      for (let n = 1; n <= N; n++) {
        if (rnd() < RATE) a++;
        if (rnd() < RATE) b++;
        if (!peeked && n % PEEK === 0 && twoProportionZTest(a, n, b, n).pValue < 0.05) peeked = true;
      }
      if (peeked) peeking++;
      if (twoProportionZTest(a, N, b, N).pValue < 0.05) fixed++;
    }
    const fixedRate = fixed / EXPERIMENTS;
    const peekRate = peeking / EXPERIMENTS;
    expect(fixedRate).toBeGreaterThan(0.02);
    expect(fixedRate).toBeLessThan(0.09); // ~5%, as α promises
    expect(peekRate).toBeGreaterThan(0.15); // peeking inflates it far past 5%
    expect(peekRate).toBeGreaterThan(fixedRate * 2.5);
  });
});

describe("significance math goldens (S14)", () => {
  it("normalCdf golden values", () => {
    expect(normalCdf(1)).toBeCloseTo(0.8413, 3);
    expect(normalCdf(2)).toBeCloseTo(0.9772, 3);
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 3);
  });

  it("z-test golden: 200/1000 vs 240/1000 → z and p pinned", () => {
    // p1=.20 p2=.24 pooled=.22 SE=sqrt(.22*.78*(2/1000))=~.018539; z=.04/.018539≈2.158; p≈0.0309.
    const { z, pValue } = twoProportionZTest(200, 1000, 240, 1000);
    expect(z).toBeCloseTo(2.158, 2);
    expect(pValue).toBeCloseTo(0.031, 2);
  });

  it("result golden: lift and significance for a clear win", () => {
    const r = computeExperimentResult([
      { variant: "control", exposed: 5000, converted: 500 },
      { variant: "test", exposed: 5000, converted: 600 },
    ]);
    expect(r.variants[0].rate).toBeCloseTo(0.1, 6);
    expect(r.variants[1].rate).toBeCloseTo(0.12, 6);
    expect(r.lift).toBeCloseTo(0.2, 6); // +20% relative
    expect(r.significant).toBe(true);
    expect(r.liftCiLow).toBeLessThan(0.2);
    expect(r.liftCiHigh).toBeGreaterThan(0.2);
  });
});
