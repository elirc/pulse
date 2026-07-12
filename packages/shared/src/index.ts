/**
 * Pulse's shared vocabulary (S01). The `Event` is the whole product's atom: a thing a person did, with
 * arbitrary properties. Everything downstream — ingestion, trends, funnels, retention — is aggregation over a
 * firehose of these.
 *
 * 📘 Properties are a JSONB bag on purpose: an analytics event's shape is defined by whoever calls the SDK, not
 * by us. That flexibility is the point of the category — and the source of the cardinality reckoning that
 * arrives in S12. Store it schemaless; pay for querying it later, deliberately.
 */
import { z } from "zod";

export * from "./cache";
export * from "./hll";
export * from "./concurrency";

/** The event as the SDK sends it over the wire to `POST /e`. `ts` is the client's clock (trusted in S1; a
 *  deliberate flaw the ingest pipeline revisits in S04/S13 — clocks lie). */
export const EventInputSchema = z.object({
  /** The public write key identifies the project; resolved to a projectId server-side (S02). */
  name: z.string().min(1).max(200),
  /** A stable-ish id for the browser/user; anonymous until identify() (S06). */
  distinctId: z.string().min(1).max(200),
  /** Arbitrary event properties. Bounded loosely here; cardinality governance is S12. */
  props: z.record(z.unknown()).default({}),
  /** Client event time (ISO or epoch ms). Optional — the server fills in if absent. */
  ts: z.union([z.string(), z.number()]).optional(),
  /** Client-minted idempotency key (SDK envelope, S03). Optional; the server mints one if absent. Dedupe (S04)
   *  and backfill idempotency (S07) both key on this. */
  uuid: z.string().min(1).max(200).optional(),
});
export type EventInput = z.infer<typeof EventInputSchema>;

/**
 * What rides on the ingestion stream (S04): the validated event plus server-resolved context. It is a
 * serializable snapshot (all strings) because it crosses a Redis Streams boundary between the ingest and
 * consumer deployables. `uuid` is the dedupe key; `ts` is still the client clock (flaw territory, S13).
 */
export interface QueuedEvent {
  uuid: string;
  projectId: string;
  distinctId: string;
  name: string;
  props: Record<string, unknown>;
  ts: string; // event time, ISO
  ingestedAt: string; // server receive time, ISO
}

/** Validates a QueuedEvent read back off the stream. A corrupt/foreign entry that fails this is a poison pill —
 *  the consumer dead-letters it rather than crashing the whole group. */
export const QueuedEventSchema = z.object({
  uuid: z.string().min(1),
  projectId: z.string().min(1),
  distinctId: z.string().min(1),
  name: z.string().min(1),
  props: z.record(z.unknown()),
  ts: z.string().min(1),
  ingestedAt: z.string().min(1),
});

/** A stored event (what the events table holds). `ingestedAt` is server time; `ts` is event time. */
export interface StoredEvent {
  id: string;
  projectId: string;
  distinctId: string;
  name: string;
  props: Record<string, unknown>;
  ts: Date;
  ingestedAt: Date;
}

/** Normalize the client-supplied `ts` (ISO string or epoch ms) to a Date; default to `now`. */
export function eventTime(ts: string | number | undefined, now: () => Date = () => new Date()): Date {
  if (ts === undefined) return now();
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  return Number.isNaN(d.getTime()) ? now() : d;
}

/** Maximum trusted clock skew between a client `ts` and server ingest time (S13): ±48h. */
export const MAX_CLOCK_SKEW_MS = 48 * 60 * 60 * 1000;

export interface ResolvedEventTime {
  ts: Date;
  /** True when the client ts was outside the skew window and was pulled to the boundary. */
  clamped: boolean;
}

/**
 * Server-authoritative event time (S13, harvests flaw #3). The client clock is BOTH attacker-controlled (forging
 * `ts` is trivial) AND innocently wrong (dead batteries, bad NTP) — so we trust-but-clamp. A client ts within
 * ±MAX_CLOCK_SKEW_MS of server ingest time is kept as-is; anything further out (events "from 2031" or "from
 * 1970") is clamped to the nearest boundary and flagged so the distortion is visible, not silent. A
 * missing/invalid ts falls back to server time. `ingestedAt` — server time — is the anchor of trust.
 */
export function resolveEventTime(
  clientTs: string | number | undefined,
  ingestedAt: Date,
  maxSkewMs: number = MAX_CLOCK_SKEW_MS,
): ResolvedEventTime {
  if (clientTs === undefined) return { ts: ingestedAt, clamped: false };
  const d = typeof clientTs === "number" ? new Date(clientTs) : new Date(clientTs);
  if (Number.isNaN(d.getTime())) return { ts: ingestedAt, clamped: false };
  const skew = d.getTime() - ingestedAt.getTime();
  if (skew > maxSkewMs) return { ts: new Date(ingestedAt.getTime() + maxSkewMs), clamped: true };
  if (skew < -maxSkewMs) return { ts: new Date(ingestedAt.getTime() - maxSkewMs), clamped: true };
  return { ts: d, clamped: false };
}

/** A daily-count row for the S01 chart: one bucket per day. */
export interface DailyCount {
  day: string; // YYYY-MM-DD
  count: number;
}

/** The UTC day key (YYYY-MM-DD) an event falls into, by its event time. */
export function dayKey(ts: Date): string {
  return ts.toISOString().slice(0, 10);
}

/**
 * Reference daily-count aggregation over events, ascending by day. This is the pure equivalent of the
 * `GROUP BY date_trunc('day', ts)` SQL the app API runs in production — kept here so the pipeline can be
 * tested end-to-end without a database, and so S07 has an executable spec of "what the query must return"
 * to check the ClickHouse version against.
 */
export function aggregateDailyCounts(events: Array<{ ts: Date }>): DailyCount[] {
  const buckets = new Map<string, number>();
  for (const e of events) {
    const key = dayKey(e.ts);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count }));
}
