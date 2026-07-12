/**
 * Behavioral cohort recompute (S09). A behavioral cohort ("did event X ≥ N times in a window") is a SCAN per
 * evaluation — too expensive to run live on every query, and it tolerates staleness (a cohort that's an hour
 * old is fine). So it's materialized on a schedule (ADR-0008): a job recomputes the member set, writes it, and
 * stamps `membersComputedAt` — the staleness contract the analyst UI shows.
 *
 * Every recompute also produces a DIFF (who joined, who left). Derived data should explain its changes: a cohort
 * that silently shrinks 40% is an incident, and the diff log is its black box. The recompute is pure over ports,
 * so it's testable without Redis or a database.
 */
import { computeBehavioralMembers, type BehavioralCohort } from "@pulse/insights";
import type { EventLike } from "@pulse/insights";

export interface BehavioralCohortRef {
  id: string;
  projectId: string;
  spec: BehavioralCohort;
}

export interface MembershipStore {
  currentMembers(cohortId: string): Promise<Set<string>>;
  replaceMembers(cohortId: string, members: Set<string>, computedAt: Date): Promise<void>;
}

export interface MembershipDiff {
  cohortId: string;
  size: number;
  added: string[];
  removed: string[];
}

/** Recompute one behavioral cohort's membership from events, persist it, and return the diff. Idempotent: the
 *  same events + same current membership yield an empty diff and identical stored state. */
export async function recomputeCohort(
  cohort: BehavioralCohortRef,
  events: EventLike[],
  store: MembershipStore,
  now: () => Date = () => new Date(),
): Promise<MembershipDiff> {
  const members = computeBehavioralMembers(events, cohort.spec, now);
  const current = await store.currentMembers(cohort.id);

  const added = [...members].filter((m) => !current.has(m)).sort();
  const removed = [...current].filter((m) => !members.has(m)).sort();

  await store.replaceMembers(cohort.id, members, now());
  return { cohortId: cohort.id, size: members.size, added, removed };
}

/** In-memory membership store for tests. */
export class InMemoryMembershipStore implements MembershipStore {
  private readonly byCohort = new Map<string, Set<string>>();
  public readonly computedAt = new Map<string, Date>();
  currentMembers(cohortId: string): Promise<Set<string>> {
    return Promise.resolve(new Set(this.byCohort.get(cohortId) ?? []));
  }
  replaceMembers(cohortId: string, members: Set<string>, computedAt: Date): Promise<void> {
    this.byCohort.set(cohortId, new Set(members));
    this.computedAt.set(cohortId, computedAt);
    return Promise.resolve();
  }
}
