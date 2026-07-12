/**
 * [J — learner-authored] The obvious funnel implementation: one pass PER STEP. Find everyone who did step 1;
 * of those, find who did step 2 in-window after; of those, step 3; and so on — each step a separate scan that
 * joins against the survivors of the previous. It is CORRECT (it's kept as the test oracle), and at the scale
 * this product runs it is a disaster: N scans of the event set plus JS joins of million-row person sets in
 * memory. Correct first — the senior pass makes it a single query next.
 */
import { matchesAll, unitOf, type EventLike } from "./compute";
import type { FunnelResult, FunnelSpec, FunnelStepResult } from "./funnel-spec";

const DAY_MS = 24 * 60 * 60 * 1000;

interface Progress {
  anchorTs: number; // step-1 entry — the window anchor
  lastTs: number; // time of the most recent completed step (for ordering)
}

export function computeFunnelNaive(
  events: EventLike[],
  spec: FunnelSpec,
  now: () => Date = () => new Date(),
): FunnelResult {
  const cutoff = now().getTime() - spec.days * DAY_MS;
  const windowMs = spec.windowDays * DAY_MS;
  const inLookback = events.filter((e) => e.ts.getTime() >= cutoff);

  // Step 1: the earliest qualifying entry per person is the anchor.
  const step0 = spec.steps[0];
  let reached = new Map<string, Progress>();
  for (const e of inLookback) {
    if (e.name !== step0.event || !matchesAll(e.props, step0.filters)) continue;
    const person = unitOf(e);
    const t = e.ts.getTime();
    const cur = reached.get(person);
    if (!cur || t < cur.anchorTs) reached.set(person, { anchorTs: t, lastTs: t });
  }

  const counts: number[] = [reached.size];
  // Steps 2..N: a fresh scan per step that keeps only survivors who advanced in-window and in order.
  for (let k = 1; k < spec.steps.length; k++) {
    const step = spec.steps[k];
    const next = new Map<string, Progress>();
    for (const e of inLookback) {
      if (e.name !== step.event || !matchesAll(e.props, step.filters)) continue;
      const person = unitOf(e);
      const prev = reached.get(person);
      if (!prev) continue;
      const t = e.ts.getTime();
      if (t >= prev.lastTs && t <= prev.anchorTs + windowMs) {
        const existing = next.get(person);
        if (!existing || t < existing.lastTs) next.set(person, { anchorTs: prev.anchorTs, lastTs: t });
      }
    }
    reached = next;
    counts.push(reached.size);
  }

  const start = counts[0];
  const steps: FunnelStepResult[] = spec.steps.map((s, i) => ({
    step: i + 1,
    event: s.event,
    count: counts[i],
    conversionFromStart: start === 0 ? 0 : counts[i] / start,
    conversionFromPrev: i === 0 ? 1 : counts[i - 1] === 0 ? 0 : counts[i] / counts[i - 1],
  }));

  // Time-to-convert for fully-converted persons: final step time − anchor.
  const durations = [...reached.values()].map((p) => p.lastTs - p.anchorTs).sort((a, b) => a - b);
  const pct = (p: number): number | null =>
    durations.length === 0 ? null : durations[Math.min(durations.length - 1, Math.floor(p * durations.length))];

  return { steps, medianTimeToConvertMs: pct(0.5), p90TimeToConvertMs: pct(0.9) };
}
