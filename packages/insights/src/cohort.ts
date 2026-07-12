/**
 * Cohort evaluation (S09) — the pure membership logic behind both kinds. Property membership is a predicate over
 * a person's properties (cheap, evaluable per-person). Behavioral membership is a scan: which people did the
 * event at least N times in the window. The behavioral scan is exactly why it gets materialized rather than run
 * live on every query.
 */
import { matchesAll, unitOf, type EventLike } from "./compute";
import type { BehavioralCohort, PropertyCohort } from "./cohort-spec";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Is a person (by their properties) in a property cohort? Cheap — no scan. */
export function personMatchesProperty(props: Record<string, unknown>, spec: PropertyCohort): boolean {
  return matchesAll(props, spec.filters);
}

/** The set of persons in a behavioral cohort: did `event` (matching filters) ≥ minCount times in the window. */
export function computeBehavioralMembers(
  events: EventLike[],
  spec: BehavioralCohort,
  now: () => Date = () => new Date(),
): Set<string> {
  const cutoff = now().getTime() - spec.windowDays * DAY_MS;
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.ts.getTime() < cutoff) continue;
    if (e.name !== spec.event || !matchesAll(e.props, spec.filters)) continue;
    const person = unitOf(e);
    counts.set(person, (counts.get(person) ?? 0) + 1);
  }
  const members = new Set<string>();
  for (const [person, n] of counts) if (n >= spec.minCount) members.add(person);
  return members;
}
