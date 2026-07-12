/**
 * Result cache for expensive analytical queries (S10). Two ideas the CRUD version of caching could skip:
 *
 * 1. Key on the query DEFINITION, not the URL. `canonicalHash` stably serializes the definition (sorting object
 *    keys) so `{a,b}` and `{b,a}` — the same query written two ways — hit the SAME cache entry. Keying on the
 *    request URL would miss constantly.
 * 2. Single-flight against the stampede. An analytical query is seconds-expensive; a 5s query × 20 dashboard
 *    viewers at 9am Monday is a dogpile that runs it 20× at once. The first miss computes; concurrent misses for
 *    the same key AWAIT that one compute instead of piling on. For CRUD this was optional; here it's mandatory.
 *
 * `computedAt` rides with every result — a cached result must be able to say how old it is (the S09 staleness
 * norm). Store is a port: in-memory for tests, Redis in production.
 */
import { createHash } from "node:crypto";

/** Stable JSON with sorted keys — the canonicalization that makes the cache key order-independent. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** A deterministic cache key for a query definition (+ any params), independent of key order. */
export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
}

export interface CachedResult<T> {
  value: T;
  computedAt: string;
  cached: boolean;
}

export interface ResultCacheOptions {
  ttlMs?: number;
  now?: () => number;
}

export class ResultCache {
  private readonly inflight = new Map<string, Promise<{ value: unknown; computedAt: string }>>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly store: CacheStore,
    opts: ResultCacheOptions = {},
  ) {
    this.ttlMs = opts.ttlMs ?? 10 * 60 * 1000; // 10 minutes
    this.now = opts.now ?? Date.now;
  }

  async getOrCompute<T>(key: string, compute: () => Promise<T>, force = false): Promise<CachedResult<T>> {
    const hit = force ? null : await this.store.get(key); // manual refresh bypasses the cached value
    if (hit !== null) {
      const parsed = JSON.parse(hit) as { value: T; computedAt: string };
      return { value: parsed.value, computedAt: parsed.computedAt, cached: true };
    }

    // Single-flight: coalesce concurrent misses for the same key onto one compute.
    const existing = this.inflight.get(key);
    if (existing) {
      const shared = (await existing) as { value: T; computedAt: string };
      return { value: shared.value, computedAt: shared.computedAt, cached: true };
    }

    const promise = (async (): Promise<{ value: T; computedAt: string }> => {
      const value = await compute();
      const computedAt = new Date(this.now()).toISOString();
      await this.store.set(key, JSON.stringify({ value, computedAt }), this.ttlMs);
      return { value, computedAt };
    })();
    this.inflight.set(key, promise);
    try {
      const fresh = await promise;
      return { value: fresh.value, computedAt: fresh.computedAt, cached: false };
    } finally {
      this.inflight.delete(key);
    }
  }
}

/** In-memory CacheStore with TTL expiry — for tests and single-instance dev. */
export class InMemoryCacheStore implements CacheStore {
  private readonly map = new Map<string, { value: string; expiresAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  get(key: string): Promise<string | null> {
    const e = this.map.get(key);
    if (!e || e.expiresAt <= this.now()) {
      this.map.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(e.value);
  }
  set(key: string, value: string, ttlMs: number): Promise<void> {
    this.map.set(key, { value, expiresAt: this.now() + ttlMs });
    return Promise.resolve();
  }
}
