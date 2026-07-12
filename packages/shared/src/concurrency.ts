/**
 * Per-key concurrency limiter (S12). A single project firing twenty heavy dashboard queries at once can pin the
 * ClickHouse cluster and starve everyone else — the classic noisy-neighbour problem in a multi-tenant analytics
 * backend. This caps how many queries a single project may have in flight; the (N+1)th is REJECTED fast with a
 * clear error rather than queued indefinitely, so the caller gets a 429 + Retry-After instead of a hung request.
 *
 * Reject-don't-queue is deliberate for interactive analytics: a query the analyst has stopped waiting for is
 * worthless, and an unbounded internal queue just moves the overload one layer down. The cap is per PROJECT, not
 * global, so a busy tenant throttles itself without affecting a quiet one.
 */
export class ConcurrencyLimitError extends Error {
  constructor(
    public readonly key: string,
    public readonly limit: number,
  ) {
    super(`concurrency limit reached for "${key}" (max ${limit} in flight)`);
    this.name = "ConcurrencyLimitError";
  }
}

export class ConcurrencyLimiter {
  private readonly inflight = new Map<string, number>();

  constructor(private readonly maxPerKey: number) {}

  /** Take a slot for `key`, or return false if it is already at the limit. */
  tryAcquire(key: string): boolean {
    const n = this.inflight.get(key) ?? 0;
    if (n >= this.maxPerKey) return false;
    this.inflight.set(key, n + 1);
    return true;
  }

  release(key: string): void {
    const n = this.inflight.get(key) ?? 0;
    if (n <= 1) this.inflight.delete(key);
    else this.inflight.set(key, n - 1);
  }

  inflightFor(key: string): number {
    return this.inflight.get(key) ?? 0;
  }

  /** Run `fn` while holding a slot; throws ConcurrencyLimitError immediately if the project is over its cap. */
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (!this.tryAcquire(key)) throw new ConcurrencyLimitError(key, this.maxPerKey);
    try {
      return await fn();
    } finally {
      this.release(key);
    }
  }
}
