/**
 * Transport (S03). Batches events and flushes on THREE independent triggers — none sufficient alone:
 *   • size  — flush at N queued events, so a busy page doesn't buffer unboundedly;
 *   • time  — flush every T ms, so a trickle of events isn't stranded forever;
 *   • visibility/unload — flush when the tab is hidden or closing (wired in pulse.ts), so the last events
 *     before the user leaves aren't lost — the single most valuable batch and the easiest to drop.
 *
 * The `Transport` interface stays stable so the Pulse core never knows which implementation it holds. The wire
 * body is always a JSON array of envelopes.
 */
import type { EventEnvelope } from "./types";

export interface Transport {
  enqueue(event: EventEnvelope): void;
  /** Flush whatever is buffered now (the time and visibility triggers). */
  flush(): void;
  /** Flush on a dying page: prefer sendBeacon, fall back to a keepalive fetch. Must be synchronous. */
  flushOnUnload(): void;
  /** Stop timers / listeners (teardown). */
  stop(): void;
}

/** Async network send (normal path). Returns success. */
export type SendFn = (batch: EventEnvelope[]) => Promise<boolean>;

/** Synchronous unload send. Returns whether the browser accepted the beacon. */
export type BeaconFn = (batch: EventEnvelope[]) => boolean;

/** Build the default network sender: POST a JSON array to `${apiHost}/e` with the public write key. */
export function httpSend(apiHost: string, writeKey: string, fetchImpl: typeof fetch = fetch): SendFn {
  return async (batch) => {
    const res = await fetchImpl(`${apiHost}/e`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${writeKey}` },
      body: JSON.stringify(batch),
      keepalive: true,
    });
    return res.ok;
  };
}

/**
 * Unload sender via `navigator.sendBeacon`. Two hard constraints shape it:
 *   • sendBeacon cannot set headers — so the write key rides the URL (`?k=`). That means the (public) key can
 *     land in server access logs; treat ingest URLs as containing a credential and redact accordingly.
 *   • it POSTs a Blob and has a ~64KB budget; it is fire-and-forget with no response to inspect.
 * Returns false when unavailable or refused, so the caller can fall back to a keepalive fetch.
 */
export function beaconSend(apiHost: string, writeKey: string): BeaconFn {
  return (batch) => {
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return false;
    const url = `${apiHost}/e?k=${encodeURIComponent(writeKey)}`;
    const blob = new Blob([JSON.stringify(batch)], { type: "application/json" });
    try {
      return navigator.sendBeacon(url, blob);
    } catch {
      return false;
    }
  };
}

export interface RetryConfig {
  /** Base delay, ms. Default 1000. */
  baseMs?: number;
  /** Give up after this many retries. Default 10. */
  maxAttempts?: number;
  /** Timer seam (injectable for fake-timer tests). */
  schedule?: (fn: () => void, ms: number) => void;
}

/**
 * Wrap a sender so a failed batch (5xx or network error) is retried with exponential backoff — wait twice as
 * long after each failure, so we don't hammer a backend that's already struggling. Succeeds as soon as any
 * attempt returns ok; gives up after `maxAttempts`.
 */
export function withRetry(send: SendFn, cfg: RetryConfig = {}): SendFn {
  const baseMs = cfg.baseMs ?? 1000;
  const maxAttempts = cfg.maxAttempts ?? 10;
  const schedule = cfg.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
  const attempt = (batch: EventEnvelope[], n: number): Promise<boolean> =>
    send(batch)
      .catch(() => false)
      .then((ok) => {
        if (ok || n >= maxAttempts) return ok;
        const delay = baseMs * 2 ** n; // back off further each time
        return new Promise<boolean>((resolve) => schedule(() => resolve(attempt(batch, n + 1)), delay));
      });
  return (batch) => attempt(batch, 0);
}

export interface BatchTransportConfig {
  send: SendFn;
  /** Synchronous unload sender (sendBeacon). Optional; falls back to `send` (keepalive) when absent/refused. */
  beacon?: BeaconFn;
  /** Flush when the queue reaches this many events. Default 10. */
  flushAt?: number;
  /** Flush at least this often, ms. Default 5000. */
  flushIntervalMs?: number;
}

/** The batching transport: a queue drained by the three triggers above. */
export class BatchTransport implements Transport {
  private queue: EventEnvelope[] = [];
  private readonly flushAt: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly send: SendFn;
  private readonly beacon: BeaconFn | undefined;

  constructor(cfg: BatchTransportConfig) {
    this.send = cfg.send;
    this.beacon = cfg.beacon;
    this.flushAt = cfg.flushAt ?? 10;
    const interval = cfg.flushIntervalMs ?? 5000;
    this.timer = setInterval(() => this.flush(), interval);
  }

  enqueue(event: EventEnvelope): void {
    this.queue.push(event);
    if (this.queue.length >= this.flushAt) this.flush();
  }

  flush(): void {
    if (this.queue.length === 0) return;
    // Drain the queue synchronously BEFORE the async send, so a second flush (timer + size firing together)
    // can never send the same events twice. On failure the events are dropped until retry (next commit).
    const batch = this.queue;
    this.queue = [];
    void this.send(batch).catch(() => {});
  }

  /** On a dying page: drain synchronously, prefer sendBeacon, fall back to a keepalive fetch. */
  flushOnUnload(): void {
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    if (this.beacon && this.beacon(batch)) return; // accepted by the browser; done
    void this.send(batch).catch(() => {}); // keepalive fetch — may or may not survive the unload
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Test/inspection helper. */
  size(): number {
    return this.queue.length;
  }
}

/** The commit-1 transport, kept for reference/tests: fire each event immediately, swallow failures. */
export class ImmediateTransport implements Transport {
  constructor(private readonly send: SendFn) {}
  enqueue(event: EventEnvelope): void {
    void this.send([event]).catch(() => {});
  }
  flush(): void {}
  flushOnUnload(): void {}
  stop(): void {}
}
