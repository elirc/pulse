import { describe, it, expect } from "vitest";
import { generateBatch, mulberry32 } from "./generate";
import { EventInputSchema } from "@pulse/shared";

describe("traffic generator (S01)", () => {
  it("is deterministic: the same seed + base time yields the identical batch", () => {
    const cfg = { users: 100, seed: 42, baseTimeMs: 1_700_000_000_000 };
    const a = generateBatch(50, cfg);
    const b = generateBatch(50, cfg);
    expect(a).toEqual(b);
    expect(generateBatch(50, { ...cfg, seed: 43 })).not.toEqual(a); // a different seed differs
  });

  it("emits valid EventInputs across the configured user pool", () => {
    const batch = generateBatch(200, { users: 10, seed: 1 });
    expect(batch).toHaveLength(200);
    for (const e of batch) expect(EventInputSchema.safeParse(e).success).toBe(true);
    const users = new Set(batch.map((e) => e.distinctId));
    expect(users.size).toBeLessThanOrEqual(10); // spread across the pool, not unbounded
    expect(users.size).toBeGreaterThan(1);
  });

  it("weights names — pageviews dominate the default catalog", () => {
    const batch = generateBatch(2000, { users: 500, seed: 7 });
    const counts = batch.reduce<Record<string, number>>((m, e) => ((m[e.name] = (m[e.name] ?? 0) + 1), m), {});
    expect(counts["$pageview"]).toBeGreaterThan(counts["purchase"] ?? 0); // the funnel skews toward the top
  });

  it("mulberry32 returns numbers in [0,1)", () => {
    const rng = mulberry32(123);
    for (let i = 0; i < 100; i++) {
      const x = rng();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
