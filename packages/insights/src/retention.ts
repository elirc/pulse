/**
 * Retention (S09) — the triangle chart. Cohort people by the day/week of their FIRST activity, then count how
 * many returned in each subsequent period. It's computed ON READ, not materialized: the output is tiny (a small
 * grid), the scan is big but it's exactly what ClickHouse is fast at, and analysts want it fresh. That's the
 * precompute-vs-compute-on-read grid (ADR-0008) placing retention in the compute-on-read corner.
 *
 * The in-memory version here is the oracle for the ClickHouse compiler (retention-sql.ts) and the fixtures.
 */
import { unitOf, type EventLike } from "./compute";

const DAY_MS = 24 * 60 * 60 * 1000;

export type Granularity = "day" | "week";

export interface RetentionSpec {
  /** Event that defines "first seen" (cohort entry). Omit = any event. */
  startEvent?: string;
  /** Event that counts as a "return". Omit = any event. */
  returnEvent?: string;
  granularity: Granularity;
  /** Number of return periods (columns) to compute. */
  periods: number;
  /** Lookback (days) for cohort formation. */
  days: number;
}

export interface CohortRow {
  bucket: string; // ISO date of the cohort's period start
  size: number;
  /** retained[p] = people from this cohort active in period p (p=0 = size). */
  retained: number[];
}

export interface RetentionResult {
  cohorts: CohortRow[];
}

/** Epoch ms of the start of the period containing `ts` (UTC; week starts Monday). "Week 0 depends on whose
 *  Monday" — we bucket in UTC and the fixtures pin it; project-timezone bucketing is a later refinement. */
export function periodStartMs(ts: number, g: Granularity): number {
  const d = new Date(ts);
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (g === "day") return dayStart;
  const dow = (new Date(dayStart).getUTCDay() + 6) % 7; // Mon=0
  return dayStart - dow * DAY_MS;
}

export function computeRetention(
  events: EventLike[],
  spec: RetentionSpec,
  now: () => Date = () => new Date(),
): RetentionResult {
  const bucketMs = spec.granularity === "day" ? DAY_MS : 7 * DAY_MS;
  const cutoff = now().getTime() - spec.days * DAY_MS;

  // Per person: first-seen time (start event), and the set of period offsets they returned in.
  const firstSeen = new Map<string, number>();
  const returnsByPerson = new Map<string, number[]>();
  for (const e of events) {
    const t = e.ts.getTime();
    if (t < cutoff) continue;
    const person = unitOf(e);
    if (spec.startEvent === undefined || e.name === spec.startEvent) {
      const cur = firstSeen.get(person);
      if (cur === undefined || t < cur) firstSeen.set(person, t);
    }
    if (spec.returnEvent === undefined || e.name === spec.returnEvent) {
      (returnsByPerson.get(person) ?? returnsByPerson.set(person, []).get(person)!).push(t);
    }
  }

  // Group persons into cohorts by their first-seen period, and tally retention per offset.
  const cohorts = new Map<number, { members: string[]; retained: number[] }>();
  for (const [person, first] of firstSeen) {
    const cohortStart = periodStartMs(first, spec.granularity);
    let cohort = cohorts.get(cohortStart);
    if (!cohort) cohorts.set(cohortStart, (cohort = { members: [], retained: new Array(spec.periods + 1).fill(0) }));
    cohort.members.push(person);
    cohort.retained[0]++; // period 0 = the cohort itself
    const returns = returnsByPerson.get(person) ?? [];
    for (let p = 1; p <= spec.periods; p++) {
      const windowStart = cohortStart + p * bucketMs;
      const windowEnd = windowStart + bucketMs;
      if (returns.some((t) => t >= windowStart && t < windowEnd)) cohort.retained[p]++;
    }
  }

  return {
    cohorts: [...cohorts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([start, c]) => ({
        bucket: new Date(start).toISOString().slice(0, 10),
        size: c.members.length,
        retained: c.retained,
      })),
  };
}
