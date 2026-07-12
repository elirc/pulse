import { describe, it, expect } from "vitest";
import { TokenBucket, KeyedRateLimiter } from "./rate-limit";

describe("TokenBucket (S13)", () => {
  it("allows a burst up to capacity, then rejects until refill", () => {
    let t = 0;
    const b = new TokenBucket({ capacity: 5, refillPerSec: 1, now: () => t });
    for (let i = 0; i < 5; i++) expect(b.tryRemove()).toBe(true); // burst of 5
    expect(b.tryRemove()).toBe(false); // empty
    t = 2000; // 2s → +2 tokens
    expect(b.tryRemove()).toBe(true);
    expect(b.tryRemove()).toBe(true);
    expect(b.tryRemove()).toBe(false);
  });

  it("never overfills past capacity no matter how long it idles", () => {
    let t = 0;
    const b = new TokenBucket({ capacity: 3, refillPerSec: 10, now: () => t });
    b.tryRemove(3); // empty it
    t = 10_000; // idle 10s → would be +100 tokens, but capacity caps at 3
    expect(b.tryRemove(3)).toBe(true);
    expect(b.tryRemove(1)).toBe(false); // only 3 were available
  });

  it("reports the seconds until enough tokens are available", () => {
    const t = 0;
    const b = new TokenBucket({ capacity: 2, refillPerSec: 2, now: () => t });
    b.tryRemove(2); // empty
    expect(b.retryAfterSec(2)).toBe(1); // need 2 tokens at 2/s → 1s
    expect(b.retryAfterSec(1)).toBe(1); // ceil(1/2) = 1
  });
});

describe("KeyedRateLimiter — per-key isolation + abuse stats (S13)", () => {
  it("caps each key independently; a noisy key doesn't throttle a quiet one", () => {
    const t = 0;
    const rl = new KeyedRateLimiter({ capacity: 2, refillPerSec: 1, now: () => t });
    expect(rl.check("noisy").allowed).toBe(true);
    expect(rl.check("noisy").allowed).toBe(true);
    expect(rl.check("noisy").allowed).toBe(false); // noisy exhausted
    expect(rl.check("quiet").allowed).toBe(true); // unaffected
  });

  it("charges cost = batch size and surfaces abusers first in stats", () => {
    const t = 0;
    const rl = new KeyedRateLimiter({ capacity: 10, refillPerSec: 1, now: () => t });
    expect(rl.check("k1", 8).allowed).toBe(true);
    expect(rl.check("k1", 8).allowed).toBe(false); // only 2 left, needs 8
    rl.check("k2", 1);
    const stats = rl.stats();
    expect(stats[0].key).toBe("k1"); // most rejections first
    expect(stats[0].rejected).toBe(1);
    expect(stats.find((s) => s.key === "k2")?.rejected).toBe(0);
  });
});
