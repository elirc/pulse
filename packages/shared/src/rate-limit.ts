/**
 * Per-key token-bucket rate limiter (S13, closes S02's deferred issue). A write key is a tap into the pipeline;
 * without a per-key limit, one compromised or buggy key can drown ingest and the bill. A token bucket is the
 * right shape for analytics: it allows short BURSTS (a page firing 20 events on load) up to `capacity`, while
 * bounding the SUSTAINED rate to `refillPerSec`. The limit is per KEY (tenant), so a noisy key throttles itself
 * without touching a quiet one — the same fairness stance as S12's per-project query cap, a different tap.
 *
 * (🔗 Tracer S13 used a token bucket for its API; the algorithm is the same, the tenancy key is different — there
 * per user, here per write key. Reconstruct the rule: rate limits are per whatever unit can independently abuse.)
 */
export interface TokenBucketConfig {
  /** Burst capacity — max tokens the bucket can hold. */
  capacity: number;
  /** Sustained refill rate, tokens per second. */
  refillPerSec: number;
  /** Clock seam (injectable for tests). */
  now?: () => number;
}

export class TokenBucket {
  private tokens: number;
  private last: number;
  private readonly capacity: number;
  private readonly refillPerSec: number;
  private readonly now: () => number;

  constructor(cfg: TokenBucketConfig) {
    this.capacity = cfg.capacity;
    this.refillPerSec = cfg.refillPerSec;
    this.now = cfg.now ?? (() => Date.now());
    this.tokens = cfg.capacity;
    this.last = this.now();
  }

  private refill(): void {
    const t = this.now();
    const elapsedSec = (t - this.last) / 1000;
    if (elapsedSec > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
      this.last = t;
    }
  }

  /** Try to consume `cost` tokens; true if there were enough (bucket debited), false otherwise. */
  tryRemove(cost = 1): boolean {
    this.refill();
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }
    return false;
  }

  /** Seconds until `cost` tokens will be available (0 if available now). For the Retry-After header. */
  retryAfterSec(cost = 1): number {
    this.refill();
    if (this.tokens >= cost) return 0;
    return Math.ceil((cost - this.tokens) / this.refillPerSec);
  }
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSec: number;
}

/** Per-key limiter + abuse observability: allowed/rejected counters per key for a monitoring surface. */
export class KeyedRateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly allowed = new Map<string, number>();
  private readonly rejected = new Map<string, number>();

  constructor(private readonly cfg: TokenBucketConfig) {}

  check(key: string, cost = 1): RateLimitDecision {
    let bucket = this.buckets.get(key);
    if (!bucket) this.buckets.set(key, (bucket = new TokenBucket(this.cfg)));
    if (bucket.tryRemove(cost)) {
      this.allowed.set(key, (this.allowed.get(key) ?? 0) + 1);
      return { allowed: true, retryAfterSec: 0 };
    }
    this.rejected.set(key, (this.rejected.get(key) ?? 0) + 1);
    return { allowed: false, retryAfterSec: bucket.retryAfterSec(cost) };
  }

  /** Abuse observability: per-key allowed/rejected counts, sorted by rejections (the abusers float up). */
  stats(): Array<{ key: string; allowed: number; rejected: number }> {
    const keys = new Set([...this.allowed.keys(), ...this.rejected.keys()]);
    return [...keys]
      .map((key) => ({ key, allowed: this.allowed.get(key) ?? 0, rejected: this.rejected.get(key) ?? 0 }))
      .sort((a, b) => b.rejected - a.rejected);
  }
}
