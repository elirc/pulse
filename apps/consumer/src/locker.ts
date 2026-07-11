/**
 * Mutual exclusion by key (S06). The identity race is create-on-first-sight running concurrently for the same
 * id; the fix is to serialize the critical section on a per-KEY basis (the user id, or the id being created) —
 * never a global lock, which would serialize the whole consumer. In production this is a Postgres
 * `pg_advisory_xact_lock` (a lock the DB already offers, scoped to a transaction); in tests it's an in-process
 * async mutex chained per key.
 */
export interface Locker {
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

/**
 * Postgres advisory-lock implementation. `pg_advisory_xact_lock` is held until the surrounding transaction
 * ends, so two consumers merging the same user id block each other on the lock acquire — serializing the
 * critical section across PROCESSES, which the in-memory locker can't do. `fn` runs inside the transaction that
 * holds the lock. `hashtextextended` maps the string key to the bigint the lock function wants.
 */
export class PrismaAdvisoryLocker implements Locker {
  constructor(
    private readonly tx: {
      $transaction<T>(fn: (client: { $executeRawUnsafe(q: string, ...v: unknown[]): Promise<number> }) => Promise<T>): Promise<T>;
    },
  ) {}

  withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return this.tx.$transaction(async (client) => {
      await client.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", key);
      return fn();
    });
  }
}

/** In-process per-key async mutex: each withLock(key) runs after the previous one on the same key settles. */
export class InMemoryLocker implements Locker {
  private readonly chain = new Map<string, Promise<unknown>>();

  withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chain.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn); // run after the previous holder settles (success or failure)
    // Keep the chain alive but swallow results so one failure can't wedge the key.
    this.chain.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }
}
