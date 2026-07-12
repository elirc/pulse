/**
 * [S — senior rebuild] The same funnel in a SINGLE pass. Group each person's events once, walk them in time
 * order, and run a state machine that advances through the steps within the window — one scan, a tiny state per
 * person, no cross-person joins. This is the in-memory twin of ClickHouse's `windowFunnel()` (funnel-sql.ts),
 * which does exactly this inside the engine over ORDER BY-local data (the S07 sort-key choice paying off).
 * Correct-then-fast: it must return what the naive oracle returns (a parity test pins it), just ~100× faster.
 */
import { matchesAll, unitOf, type EventLike } from "./compute";
import type {
  FunnelBreakdownResult,
  FunnelResult,
  FunnelSpec,
  FunnelStep,
  FunnelStepResult,
} from "./funnel-spec";

const DAY_MS = 24 * 60 * 60 * 1000;

function matchesStep(e: EventLike, step: FunnelStep): boolean {
  return e.name === step.event && matchesAll(e.props, step.filters);
}

/** Exact percentile of an ascending-sorted array (the "obvious" implementation, kept as the oracle for CH's
 *  quantile() sketch). */
export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length))];
}

export function computeFunnel(
  events: EventLike[],
  spec: FunnelSpec,
  now: () => Date = () => new Date(),
): FunnelResult {
  const cutoff = now().getTime() - spec.days * DAY_MS;
  const windowMs = spec.windowDays * DAY_MS;
  const n = spec.steps.length;

  const byPerson = new Map<string, EventLike[]>();
  for (const e of events) {
    if (e.ts.getTime() < cutoff) continue;
    const person = unitOf(e);
    (byPerson.get(person) ?? byPerson.set(person, []).get(person)!).push(e);
  }

  const counts = new Array<number>(n).fill(0);
  const durations: number[] = [];

  for (const evs of byPerson.values()) {
    evs.sort((a, b) => a.ts.getTime() - b.ts.getTime());
    let level = 0; // steps completed so far
    let anchor = 0;
    let finalTs = 0;
    for (const e of evs) {
      const t = e.ts.getTime();
      if (level === 0) {
        if (matchesStep(e, spec.steps[0])) {
          anchor = t;
          level = 1;
          if (n === 1) finalTs = t;
        }
      } else if (level < n && matchesStep(e, spec.steps[level]) && t <= anchor + windowMs) {
        level++;
        if (level === n) finalTs = t;
      }
    }
    for (let k = 1; k <= level; k++) counts[k - 1]++;
    if (level === n) durations.push(finalTs - anchor);
  }

  const start = counts[0];
  const steps: FunnelStepResult[] = spec.steps.map((s, i) => ({
    step: i + 1,
    event: s.event,
    count: counts[i],
    conversionFromStart: start === 0 ? 0 : counts[i] / start,
    conversionFromPrev: i === 0 ? 1 : counts[i - 1] === 0 ? 0 : counts[i] / counts[i - 1],
  }));

  durations.sort((a, b) => a - b);
  return {
    steps,
    medianTimeToConvertMs: percentile(durations, 0.5),
    p90TimeToConvertMs: percentile(durations, 0.9),
  };
}

/**
 * Funnel broken down by a property: group people by their step-1 event's property value, compute a funnel per
 * value, keep the top-N by entrants. (Uses the single-pass computeFunnel per group.)
 */
export function computeFunnelBreakdown(
  events: EventLike[],
  spec: FunnelSpec,
  now: () => Date = () => new Date(),
  topN = 10,
): FunnelBreakdownResult[] {
  if (!spec.breakdown) return [{ label: "All", result: computeFunnel(events, spec, now) }];

  // Assign each person a breakdown label from their FIRST step-1 event's property.
  const step0 = spec.steps[0];
  const labelOf = new Map<string, string>();
  for (const e of events) {
    if (e.name !== step0.event) continue;
    const person = unitOf(e);
    if (!labelOf.has(person)) {
      const v = e.props[spec.breakdown];
      labelOf.set(person, v === undefined || v === null ? "(none)" : String(v));
    }
  }
  const groups = new Map<string, EventLike[]>();
  for (const e of events) {
    const label = labelOf.get(unitOf(e));
    if (label === undefined) continue;
    (groups.get(label) ?? groups.set(label, []).get(label)!).push(e);
  }
  return [...groups.entries()]
    .map(([label, evs]) => ({ label, result: computeFunnel(evs, spec, now) }))
    .sort((a, b) => b.result.steps[0].count - a.result.steps[0].count)
    .slice(0, topN);
}
