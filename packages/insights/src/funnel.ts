/**
 * [S — senior rebuild] The same funnel in a SINGLE pass. Group each person's events once, walk them in time
 * order, and run a state machine that advances through the steps within the window — one scan, a tiny state per
 * person, no cross-person joins. This is the in-memory twin of ClickHouse's `windowFunnel()` (funnel-sql.ts),
 * which does exactly this inside the engine over ORDER BY-local data (the S07 sort-key choice paying off).
 * Correct-then-fast: it must return what the naive oracle returns (a parity test pins it), just ~100× faster.
 */
import { matchesAll, unitOf, type EventLike } from "./compute";
import type { FunnelResult, FunnelSpec, FunnelStep, FunnelStepResult } from "./funnel-spec";

const DAY_MS = 24 * 60 * 60 * 1000;

function matchesStep(e: EventLike, step: FunnelStep): boolean {
  return e.name === step.event && matchesAll(e.props, step.filters);
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
  const medianTimeToConvertMs = durations.length === 0 ? null : durations[Math.floor(durations.length / 2)];
  return { steps, medianTimeToConvertMs };
}
