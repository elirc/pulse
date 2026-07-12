/**
 * GDPR deletion in an append-only columnar store (S13) — the material no other course has. Deleting a person is
 * NOT a row operation here: events live append-only in ClickHouse, and copies of the person also exist in
 * Postgres metadata, cohort materializations (S09), and the tile result cache (S10). So deletion is a
 * background, multi-store SWEEP with a verification obligation — you haven't deleted anything until you've proven
 * every copy is gone (count-to-zero). This module is the pure orchestrator; the ports do the store-specific work
 * (Prisma, ClickHouse lightweight deletes, cache flush) and are injected so CI runs the whole flow store-free.
 *
 * A deletion-request LEDGER records every request and its outcome — compliance is not "we deleted it", it's
 * "here is provable evidence we deleted it, months later".
 */
export type DeletionStatus = "pending" | "completed" | "failed";

export interface DeletionRequest {
  id: string;
  personId: string;
  status: DeletionStatus;
  requestedAt: string;
  completedAt?: string;
  distinctIds: string[];
  /** Rows the columnar delete removed (best-effort count). */
  rowsDeleted?: number;
  /** Rows still present at verification — MUST be 0 for `completed`; non-zero → `failed`. */
  remaining?: number;
}

export interface DeletionLedgerPort {
  create(req: DeletionRequest): Promise<void>;
  update(id: string, patch: Partial<DeletionRequest>): Promise<void>;
  get(id: string): Promise<DeletionRequest | null>;
  list(): Promise<DeletionRequest[]>;
}

export interface DeletionPorts {
  /** All distinctIds that resolve to this person (the join key events are keyed by). */
  resolveDistinctIds(personId: string): Promise<string[]>;
  /** Hard-delete Postgres metadata: Person, DistinctIdMapping, CohortMembership. */
  deleteMetadata(personId: string): Promise<void>;
  /** ClickHouse lightweight delete of every event for these distinctIds. Returns rows removed if known. */
  deleteEvents(distinctIds: string[]): Promise<number>;
  /** Invalidate every cached copy — the tile cache (S10) would otherwise serve deleted data until TTL. */
  flushCaches(personId: string, distinctIds: string[]): Promise<void>;
  /** Verification: how many event rows remain for these distinctIds. Completed requires 0. */
  countRemaining(distinctIds: string[]): Promise<number>;
  ledger: DeletionLedgerPort;
}

/** In-memory ledger for CI/tests; production persists to Postgres for the compliance evidence trail. */
export class InMemoryDeletionLedger implements DeletionLedgerPort {
  private readonly rows = new Map<string, DeletionRequest>();
  create(req: DeletionRequest): Promise<void> {
    this.rows.set(req.id, { ...req });
    return Promise.resolve();
  }
  update(id: string, patch: Partial<DeletionRequest>): Promise<void> {
    const cur = this.rows.get(id);
    if (cur) this.rows.set(id, { ...cur, ...patch });
    return Promise.resolve();
  }
  get(id: string): Promise<DeletionRequest | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }
  list(): Promise<DeletionRequest[]> {
    return Promise.resolve([...this.rows.values()]);
  }
}

/**
 * Execute a full person deletion across every store, recording each step in the ledger. The order matters:
 * delete the DATA (events) before declaring done, flush caches so no stale copy is served, then VERIFY. If any
 * rows survive, the request is marked `failed` — an unverified deletion is not a deletion.
 */
export async function executePersonDeletion(
  personId: string,
  ports: DeletionPorts,
  idGen: () => string = () => `del_${Math.random().toString(36).slice(2)}`,
  now: () => Date = () => new Date(),
): Promise<DeletionRequest> {
  const id = idGen();
  const distinctIds = await ports.resolveDistinctIds(personId);
  const req: DeletionRequest = {
    id,
    personId,
    status: "pending",
    requestedAt: now().toISOString(),
    distinctIds,
  };
  await ports.ledger.create(req);

  await ports.deleteMetadata(personId);
  const rowsDeleted = await ports.deleteEvents(distinctIds);
  await ports.flushCaches(personId, distinctIds);
  const remaining = await ports.countRemaining(distinctIds);

  const status: DeletionStatus = remaining === 0 ? "completed" : "failed";
  const patch: Partial<DeletionRequest> = {
    status,
    rowsDeleted,
    remaining,
    completedAt: now().toISOString(),
  };
  await ports.ledger.update(id, patch);
  return { ...req, ...patch };
}
