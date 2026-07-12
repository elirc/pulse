/**
 * "Online now" (S11) — a sliding-window unique-visitor counter. A sorted set keyed on last-seen timestamp:
 * `ZADD` a distinctId with score = now on every event, `ZREMRANGEBYSCORE` to evict everyone last seen before the
 * window, and `ZCARD` the rest. O(log n) upkeep, self-expiring, EXACT — which beats HyperLogLog here precisely
 * because the window is small (a few minutes of active users), so exactness is cheap. State lives in Redis
 * (ephemeral); the durable copy is in ClickHouse — the durable/ephemeral split, data-sized.
 */
export interface SortedSetStore {
  add(key: string, member: string, score: number): Promise<void>;
  removeBelow(key: string, maxScore: number): Promise<void>;
  countAtOrAbove(key: string, minScore: number): Promise<number>;
}

export interface OnlineWindowOptions {
  windowMs?: number;
  now?: () => number;
}

export class OnlineWindow {
  private readonly windowMs: number;
  private readonly now: () => number;
  constructor(
    private readonly store: SortedSetStore,
    opts: OnlineWindowOptions = {},
  ) {
    this.windowMs = opts.windowMs ?? 5 * 60 * 1000;
    this.now = opts.now ?? Date.now;
  }

  private key(projectId: string): string {
    return `online:${projectId}`;
  }

  /** Mark a distinctId as seen at `tsMs` (defaults to now). */
  async seen(projectId: string, distinctId: string, tsMs: number = this.now()): Promise<void> {
    await this.store.add(this.key(projectId), distinctId, tsMs);
  }

  /** Count distinct visitors seen within the window. Evicts the stale ones first (self-expiring). */
  async count(projectId: string): Promise<number> {
    const cutoff = this.now() - this.windowMs;
    await this.store.removeBelow(this.key(projectId), cutoff);
    return this.store.countAtOrAbove(this.key(projectId), cutoff);
  }
}

/** The slice of a Redis client this uses (ioredis satisfies it). ZADD / ZREMRANGEBYSCORE / ZCOUNT. */
export interface RedisZ {
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zremrangebyscore(key: string, min: number, max: number): Promise<unknown>;
  zcount(key: string, min: number, max: string | number): Promise<number>;
}

export class RedisSortedSetStore implements SortedSetStore {
  constructor(private readonly redis: RedisZ) {}
  async add(key: string, member: string, score: number): Promise<void> {
    await this.redis.zadd(key, score, member);
  }
  async removeBelow(key: string, maxScore: number): Promise<void> {
    await this.redis.zremrangebyscore(key, -Infinity, maxScore - 1);
  }
  countAtOrAbove(key: string, minScore: number): Promise<number> {
    return this.redis.zcount(key, minScore, "+inf");
  }
}

/** In-memory sorted set for tests. */
export class InMemorySortedSetStore implements SortedSetStore {
  private readonly sets = new Map<string, Map<string, number>>();
  private set(key: string): Map<string, number> {
    let s = this.sets.get(key);
    if (!s) this.sets.set(key, (s = new Map()));
    return s;
  }
  add(key: string, member: string, score: number): Promise<void> {
    this.set(key).set(member, score); // last-seen wins
    return Promise.resolve();
  }
  removeBelow(key: string, maxScore: number): Promise<void> {
    const s = this.set(key);
    for (const [member, score] of s) if (score < maxScore) s.delete(member);
    return Promise.resolve();
  }
  countAtOrAbove(key: string, minScore: number): Promise<number> {
    let n = 0;
    for (const score of this.set(key).values()) if (score >= minScore) n++;
    return Promise.resolve(n);
  }
}
