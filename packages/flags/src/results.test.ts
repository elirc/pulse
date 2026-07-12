import { describe, it, expect } from "vitest";
import { computeExperimentResult, twoProportionZTest, normalCdf, requiredSampleSizePerVariant } from "./results";

describe("significance math (S14)", () => {
  it("normalCdf matches known values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 4);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.959964)).toBeCloseTo(0.025, 3);
  });

  it("two-proportion z-test flags a large, clear difference as significant", () => {
    // 100/1000 vs 150/1000 — a real 5pp lift on a big sample.
    const { pValue } = twoProportionZTest(100, 1000, 150, 1000);
    expect(pValue).toBeLessThan(0.01);
  });

  it("finds no significance in a tiny or null difference", () => {
    const { pValue } = twoProportionZTest(100, 1000, 102, 1000);
    expect(pValue).toBeGreaterThan(0.05);
  });

  it("computes lift and a CI that brackets the point estimate", () => {
    const r = computeExperimentResult([
      { variant: "control", exposed: 1000, converted: 100 },
      { variant: "test", exposed: 1000, converted: 130 },
    ]);
    expect(r.variants[0].rate).toBeCloseTo(0.1, 5);
    expect(r.lift).toBeCloseTo(0.3, 5); // (0.13-0.10)/0.10
    expect(r.liftCiLow).toBeLessThan(r.lift);
    expect(r.liftCiHigh).toBeGreaterThan(r.lift);
    expect(r.significant).toBe(true);
  });

  it("required sample size grows as the detectable effect shrinks", () => {
    const big = requiredSampleSizePerVariant(0.1, 0.5); // detect a 50% relative lift
    const small = requiredSampleSizePerVariant(0.1, 0.05); // detect a 5% relative lift
    expect(small).toBeGreaterThan(big);
    expect(big).toBeGreaterThan(0);
  });
});
