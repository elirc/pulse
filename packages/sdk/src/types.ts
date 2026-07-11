/**
 * The Pulse browser SDK (S03) — a zero-dependency library that runs on strangers' pages under a hard bundle
 * budget and a "never break the host page" policy. These are the shared shapes.
 */

/** The event as it leaves the browser. The `uuid` is minted here, at the SDK, on purpose (see id.ts). */
export interface EventEnvelope {
  /** Client-minted idempotency key. S04 dedupes on it; S07 backfill relies on it being stable. */
  uuid: string;
  name: string;
  distinctId: string;
  props: Record<string, unknown>;
  /** Client event time, ISO 8601. The server may override/clamp (S13); trusted at the edge for now. */
  ts: string;
}

export interface PulseOptions {
  /** Public write key (`pw_live_…`). Rides in the request; it is meant to be public. */
  writeKey: string;
  /** Ingest host. Defaults to the public ingest endpoint. */
  apiHost?: string;
  /** Flush when this many events are queued. Default 10. */
  flushAt?: number;
  /** Flush at least this often, ms. Default 5000. */
  flushIntervalMs?: number;
  /** Emit `$pageview` automatically on SPA navigation. Default true. */
  autocapturePageviews?: boolean;
  /** Cap on events buffered to localStorage before the oldest are dropped. Default 1000. */
  maxQueue?: number;
  /** Optional sink for the SDK's *own* errors (it never throws into your page; it can tell you quietly). */
  onError?: (error: unknown) => void;
}
