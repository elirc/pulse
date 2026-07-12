import { describe, it, expect } from "vitest";
import { HyperLogLog } from "./hll";

describe("HyperLogLog (S12)", () => {
  it("estimates small cardinalities exactly-ish (linear counting)", () => {
    const hll = new HyperLogLog();
    for (let i = 0; i < 100; i++) hll.add(`v${i}`);
    const est = hll.estimate();
    expect(est).toBeGreaterThan(90);
    expect(est).toBeLessThan(110);
  });

  it("estimates a large cardinality within a few percent", () => {
    const hll = new HyperLogLog();
    const N = 50_000;
    for (let i = 0; i < N; i++) hll.add(`user-${i}`);
    const est = hll.estimate();
    const err = Math.abs(est - N) / N;
    expect(err).toBeLessThan(0.05); // ~1.6% expected; generous bound
  });

  it("duplicates don't inflate the estimate", () => {
    const hll = new HyperLogLog();
    for (let r = 0; r < 100; r++) for (let i = 0; i < 10; i++) hll.add(`x${i}`);
    expect(hll.estimate()).toBeLessThan(20); // ~10 distinct despite 1000 adds
  });
});
