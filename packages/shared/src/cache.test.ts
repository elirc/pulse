import { describe, it, expect, vi } from "vitest";
import { canonicalHash, ResultCache, InMemoryCacheStore } from "./cache";

describe("canonicalHash (S10)", () => {
  it("is independent of object key order", () => {
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }));
    expect(canonicalHash({ steps: [{ event: "a" }, { event: "b" }] })).toBe(
      canonicalHash({ steps: [{ event: "a" }, { event: "b" }] }),
    );
  });
  it("differs when the definition differs", () => {
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
  });
});

describe("ResultCache (S10)", () => {
  it("miss computes, hit serves from cache with computedAt", async () => {
    const cache = new ResultCache(new InMemoryCacheStore(), { ttlMs: 10_000 });
    const compute = vi.fn(() => Promise.resolve(42));
    const first = await cache.getOrCompute("k", compute);
    const second = await cache.getOrCompute("k", compute);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.value).toBe(42);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(typeof second.computedAt).toBe("string");
  });

  it("re-computes after the TTL expires", async () => {
    let clock = 0;
    const cache = new ResultCache(new InMemoryCacheStore(() => clock), { ttlMs: 1000, now: () => clock });
    const compute = vi.fn(() => Promise.resolve(1));
    await cache.getOrCompute("k", compute);
    clock = 2000; // past TTL
    await cache.getOrCompute("k", compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("single-flight: 20 concurrent misses for one key run the compute ONCE (the stampede fix)", async () => {
    const cache = new ResultCache(new InMemoryCacheStore(), { ttlMs: 10_000 });
    let running = 0;
    let maxConcurrent = 0;
    const compute = async (): Promise<number> => {
      running++;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return 7;
    };
    const results = await Promise.all(Array.from({ length: 20 }, () => cache.getOrCompute("hot", compute)));
    expect(maxConcurrent).toBe(1); // never more than one compute at a time
    expect(results.every((r) => r.value === 7)).toBe(true);
    expect(results.filter((r) => !r.cached)).toHaveLength(1); // exactly one did the compute
  });
});
