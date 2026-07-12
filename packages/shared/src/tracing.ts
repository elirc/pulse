/**
 * Sampled distributed tracing (S15) — the event uuid's final job. The same client-minted uuid that keyed dedupe
 * (S04) and backfill idempotency (S07) now stitches a trace: ingest → stream → consumer → insert. Observability
 * at data volume has a hard constraint: tracing EVERY event would out-volume the events themselves. So we sample
 * ~1% — but the sampling must be DETERMINISTIC ON THE UUID, so every stage independently makes the same
 * keep/drop decision and a sampled event produces a COMPLETE trace, never fragments from disagreeing stages.
 *
 * The division of labour: sample traces, COUNT everything. Debugging one specific lost event needs the loss
 * accounting (which counts all of them), not a trace you almost certainly didn't sample. Traces answer "what's
 * the typical path and where's the latency"; the accounting answers "did we keep event X".
 */
import { hash32 } from "./bucketing";

export const DEFAULT_TRACE_SAMPLE_RATE = 0.01;

export type TraceStage = "ingest" | "stream" | "consumer" | "insert";

export interface TraceSpan {
  uuid: string;
  stage: TraceStage;
  atMs: number;
}

/** Deterministic per-uuid trace decision — every stage computes the same answer for the same event. */
export function shouldTrace(uuid: string, sampleRate: number = DEFAULT_TRACE_SAMPLE_RATE): boolean {
  return hash32(`trace:${uuid}`) / 0x100000000 < sampleRate;
}

/** Total wall time of a trace (first to last span), or null if fewer than two spans. */
export function traceDurationMs(spans: TraceSpan[]): number | null {
  if (spans.length < 2) return null;
  const times = spans.map((s) => s.atMs);
  return Math.max(...times) - Math.min(...times);
}
