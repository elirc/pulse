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
  /** Flush whatever is buffered now (used by the time trigger and on unload). */
  flush(): void;
  /** Stop timers / listeners (teardown; also called before an unload beacon in later commits). */
  stop(): void;
}

export type SendFn = (batch: EventEnvelope[]) => Promise<boolean>;

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

export interface BatchTransportConfig {
  send: SendFn;
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

  constructor(cfg: BatchTransportConfig) {
    this.send = cfg.send;
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
  stop(): void {}
}
