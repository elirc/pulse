/**
 * Identity resolution (S06) — the write-path stage that turns a distinctId into a personId, creating a Person
 * the first time it sees an id (create-on-first-sight). Resolving HERE, once, on the write path — rather than
 * at every query — is the decision that keeps every downstream query (trends, funnels, retention) a simple
 * count over a frozen personId, instead of a graph traversal. The cost of that choice: a merge (S06 identify)
 * must fix the FUTURE via the mapping table, because the past is already frozen into the event rows (which we
 * never rewrite — the event log is immutable).
 *
 * The resolver caches distinctId → personId with a TTL to keep the write path cheap. That cache is also the
 * thing a merge must invalidate, or events mis-attribute for the TTL window (see identify).
 */

export interface PersonStore {
  /** The personId a distinctId currently maps to, or null if unseen. */
  findPersonId(projectId: string, distinctId: string): Promise<string | null>;
  /** Create a Person and map `distinctId` to it, returning the new personId. */
  createPersonWithMapping(projectId: string, distinctId: string): Promise<string>;
  /** A comparable creation order for a person (epoch ms or a sequence) — for deterministic "oldest wins". */
  createdOrder(personId: string): Promise<number>;
  /** Re-point every mapping from `fromPersonId` to `toPersonId`; returns the distinctIds that moved. */
  remapMappings(projectId: string, fromPersonId: string, toPersonId: string): Promise<string[]>;
  /** Fold `loserId`'s properties into `winnerId` ($set_once on the winner is not overwritten). */
  foldProperties(winnerId: string, loserId: string): Promise<void>;
  /** Delete a person (after its mappings + properties have been folded away). */
  deletePerson(personId: string): Promise<void>;
}

export interface ResolverOptions {
  ttlMs?: number;
  now?: () => number;
}

interface CacheEntry {
  personId: string;
  expiresAt: number;
}

export class IdentityResolver {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    protected readonly store: PersonStore,
    opts: ResolverOptions = {},
  ) {
    this.ttlMs = opts.ttlMs ?? 60_000;
    this.now = opts.now ?? Date.now;
  }

  private cacheKey(projectId: string, distinctId: string): string {
    return `${projectId}:${distinctId}`;
  }

  /** Resolve a distinctId to its personId, creating the Person on first sight. */
  async resolve(projectId: string, distinctId: string): Promise<string> {
    const key = this.cacheKey(projectId, distinctId);
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > this.now()) return hit.personId;

    let personId = await this.store.findPersonId(projectId, distinctId);
    personId ??= await this.store.createPersonWithMapping(projectId, distinctId);
    this.cache.set(key, { personId, expiresAt: this.now() + this.ttlMs });
    return personId;
  }

  /**
   * identify: an anonymous id and a known user id become ONE person. The older person wins (deterministic, so a
   * re-merge is idempotent); the loser's mappings + properties fold into the winner and the loser is deleted.
   * The event rows are NEVER rewritten — only the mapping table changes, so history stays intact and future
   * events for either id resolve to the winner. The cache is re-primed for every moved id, or those events
   * would mis-attribute to the deleted person for the TTL window.
   *
   * NOTE (S06): this is the NAIVE version — no lock. Two concurrent identifies for the same user can each create
   * a person and tangle the merge. The race is demonstrated and fixed in the next two commits.
   */
  async identify(projectId: string, anonDistinctId: string, userDistinctId: string): Promise<string> {
    const anonPerson = await this.resolve(projectId, anonDistinctId);
    const userPerson = await this.resolve(projectId, userDistinctId);
    if (anonPerson === userPerson) return userPerson;

    const [anonOrder, userOrder] = await Promise.all([
      this.store.createdOrder(anonPerson),
      this.store.createdOrder(userPerson),
    ]);
    const winner = anonOrder <= userOrder ? anonPerson : userPerson;
    const loser = winner === anonPerson ? userPerson : anonPerson;

    const moved = await this.store.remapMappings(projectId, loser, winner);
    await this.store.foldProperties(winner, loser);
    await this.store.deletePerson(loser);
    for (const distinctId of moved) this.prime(projectId, distinctId, winner);
    return winner;
  }

  /** Drop a cache entry (used after a merge remaps a distinctId to a different person). */
  protected invalidate(projectId: string, distinctId: string): void {
    this.cache.delete(this.cacheKey(projectId, distinctId));
  }

  /** Overwrite a cache entry to point a distinctId at a person (post-merge). */
  protected prime(projectId: string, distinctId: string, personId: string): void {
    this.cache.set(this.cacheKey(projectId, distinctId), { personId, expiresAt: this.now() + this.ttlMs });
  }
}
