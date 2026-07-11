/**
 * Write-key resolution on the ingest hot path (S02) — the FIRST hot-path performance decision of the course.
 *
 * Authenticating `POST /e` adds a credential lookup to EVERY event. A per-request database round-trip would
 * make auth the bottleneck before storage ever is, so we cache the hash→key mapping in-process with a TTL.
 *
 * The cost of that cache is stated out loud: a revoked key keeps working until its cache entry expires — up to
 * `ttlMs` of "undead key". We accept ~60s of revocation lag on the hot path as the price of not touching the DB
 * per event, and we WRITE THAT DOWN (here and in ADR-0003) rather than discovering it in an incident. The
 * management side can offer instant revocation later via a cache-bust signal; the hot path stays cheap.
 *
 * `lastUsedAt` is likewise sampled, not written per event: updating a row on every ingest would double the
 * write load the hot path exists to minimize. A ~1% sample is enough to answer "is this key still in use?".
 */
import { hashApiKey, type KeyType } from "./keys";

export interface ResolvedKey {
  id: string;
  projectId: string;
  type: KeyType;
  revokedAt: Date | null;
  /** Optional per-key origin allowlist (S02). Absent/empty = any origin. See origin.ts. */
  allowedOrigins?: string[];
}

/** The storage port. Production wires a Prisma-backed implementation; tests use {@link InMemoryKeyStore}. */
export interface KeyStore {
  findByHash(hash: string): Promise<ResolvedKey | null>;
  touchLastUsed(id: string): Promise<void>;
}

/** Pure sampling decision, extracted so it can be tested without a clock or a store. */
export function shouldSample(rng: () => number, rate: number): boolean {
  return rng() < rate;
}

export interface ResolverOptions {
  /** Cache lifetime in ms — the maximum revocation lag ("undead key" window). Default 60_000. */
  ttlMs?: number;
  now?: () => number;
  /** RNG in [0,1) for lastUsedAt sampling; injectable for deterministic tests. */
  rng?: () => number;
  /** Fraction of resolves that write lastUsedAt. Default 0.01 (1%). */
  sampleRate?: number;
}

interface CacheEntry {
  key: ResolvedKey;
  expiresAt: number;
}

export class CachedKeyResolver {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly rng: () => number;
  private readonly sampleRate: number;

  constructor(
    private readonly store: KeyStore,
    opts: ResolverOptions = {},
  ) {
    this.ttlMs = opts.ttlMs ?? 60_000;
    this.now = opts.now ?? Date.now;
    this.rng = opts.rng ?? Math.random;
    this.sampleRate = opts.sampleRate ?? 0.01;
  }

  /**
   * Resolve a plaintext key to its project + type, or `null` if unknown or revoked. Cache hits skip the store
   * entirely (this is the undead-key window). On a miss, a live (non-revoked) key is cached; a revoked key is
   * rejected and never cached as valid.
   */
  async resolve(plaintext: string): Promise<ResolvedKey | null> {
    const hash = hashApiKey(plaintext);
    const now = this.now();

    const hit = this.cache.get(hash);
    if (hit && hit.expiresAt > now) {
      this.maybeTouch(hit.key.id);
      return hit.key;
    }

    const key = await this.store.findByHash(hash);
    if (!key || key.revokedAt !== null) return null;

    this.cache.set(hash, { key, expiresAt: now + this.ttlMs });
    this.maybeTouch(key.id);
    return key;
  }

  /** Fire-and-forget, sampled lastUsedAt write. Must never add latency or throw into the hot path. */
  private maybeTouch(id: string): void {
    if (!shouldSample(this.rng, this.sampleRate)) return;
    void this.store.touchLastUsed(id).catch(() => {});
  }
}

/** An in-memory {@link KeyStore} for tests and local dev — the same seam the servers use to stay DB-free in CI. */
export class InMemoryKeyStore implements KeyStore {
  private readonly byHash = new Map<string, ResolvedKey>();
  public touches: string[] = [];

  add(hash: string, key: ResolvedKey): void {
    this.byHash.set(hash, key);
  }

  findByHash(hash: string): Promise<ResolvedKey | null> {
    return Promise.resolve(this.byHash.get(hash) ?? null);
  }

  touchLastUsed(id: string): Promise<void> {
    this.touches.push(id);
    return Promise.resolve();
  }
}
