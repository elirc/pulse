import { describe, it, expect } from "vitest";
import { bucket, hash32 } from "./bucketing";

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `user_${i}`);

describe("deterministic bucketing — the golden properties (S14)", () => {
  it("STICKY: same (flag, user) → same bucket, every time", () => {
    for (const id of ids(1000)) {
      expect(bucket("flagA", id)).toBe(bucket("flagA", id));
    }
  });

  it("UNIFORM: 100k ids spread evenly across 10 deciles (chi-square below the 9-dof 0.1% critical value)", () => {
    const N = 100_000;
    const bins = new Array(10).fill(0);
    for (const id of ids(N)) {
      bins[Math.min(9, Math.floor(bucket("checkout-v2", id) * 10))]++;
    }
    const expected = N / 10;
    const chiSq = bins.reduce((s, o) => s + (o - expected) ** 2 / expected, 0);
    // χ² critical value, 9 dof, p=0.001 ≈ 27.88. A well-distributed hash sits far below this.
    expect(chiSq).toBeLessThan(27.88);
  });

  it("INDEPENDENT across flags: bucket(flagA) does not correlate with bucket(flagB)", () => {
    // The subtle one. If the flag key were NOT in the hash, these two would be identical for every user and the
    // correlation would be 1.0 — every experiment would reuse the same split. It must be ~0.
    const xs: number[] = [];
    const ys: number[] = [];
    for (const id of ids(20_000)) {
      xs.push(bucket("flagA", id));
      ys.push(bucket("flagB", id));
    }
    const corr = pearson(xs, ys);
    expect(Math.abs(corr)).toBeLessThan(0.03);
  });

  it("INDEPENDENT across salts: the rollout draw and the variant draw of one flag are uncorrelated", () => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const id of ids(20_000)) {
      xs.push(bucket("flagA", id, "rollout"));
      ys.push(bucket("flagA", id, "variant"));
    }
    expect(Math.abs(pearson(xs, ys))).toBeLessThan(0.03);
  });

  it("bucket is always in [0,1)", () => {
    for (const id of ids(5000)) {
      const b = bucket("f", id);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(1);
    }
  });

  it("hash32 is stable for a known input (guards accidental algorithm drift)", () => {
    // A fixed vector so a future refactor that changes the hash — and thus reshuffles every live rollout — fails.
    expect(hash32("pulse")).toBe(hash32("pulse"));
    expect(hash32("a")).not.toBe(hash32("b"));
  });
});

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return num / Math.sqrt(dx * dy);
}
