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
import type { SafeStorage } from "./storage";

const QUEUE_KEY = "pulse_queue";

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

/**
 * Circuit breaker (S13, harvests flaw #1). Shared across all batches from one page so the SDK stops hammering a
 * backend that's already down: after `threshold` consecutive failures the circuit OPENs and sends fail fast
 * (events park in the overflow queue instead of firing). After `cooldownMs` it goes HALF-open and lets exactly
 * ONE probe through; a success closes it, a failure re-opens it. This is what stops the recovery herd — even
 * with jitter, N tabs all retrying is N× load; a breaker means a struggling backend sees one probe, not a flood.
 */
export interface CircuitBreakerConfig {
  /** Consecutive failures before the circuit opens. Default 5. */
  threshold?: number;
  /** How long to stay open before allowing a probe, ms. Default 30_000. */
  cooldownMs?: number;
  /** Clock seam (injectable for fake-timer tests). */
  now?: () => number;
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private state: "closed" | "open" | "half" = "closed";
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(cfg: CircuitBreakerConfig = {}) {
    this.threshold = cfg.threshold ?? 5;
    this.cooldownMs = cfg.cooldownMs ?? 30_000;
    this.now = cfg.now ?? (() => Date.now());
  }

  /** True if a request may proceed. Transitions open→half (allowing one probe) when the cooldown has elapsed. */
  canRequest(): boolean {
    if (this.state === "open") {
      if (this.now() - this.openedAt >= this.cooldownMs) {
        this.state = "half"; // let a single probe through
        return true;
      }
      return false;
    }
    if (this.state === "half") return false; // the probe is in flight; hold everyone else back
    return true;
  }

  onSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  onFailure(): void {
    this.failures += 1;
    if (this.state === "half" || this.failures >= this.threshold) {
      this.state = "open";
      this.openedAt = this.now();
    }
  }

  get status(): "closed" | "open" | "half" {
    return this.state;
  }
}

export interface RetryConfig {
  /** Base delay, ms. Default 1000. */
  baseMs?: number;
  /** Give up after this many retries. Default 10. */
  maxAttempts?: number;
  /** Cap the backoff delay so it can't grow unbounded (S13). Default 30_000. */
  maxDelayMs?: number;
  /** Jitter source in [0,1). Default Math.random. Full jitter DECORRELATES clients so they don't retry in lockstep. */
  jitter?: () => number;
  /** Shared circuit breaker (S13). Absent → a private one is created per wrapped sender. */
  breaker?: CircuitBreaker;
  /** Timer seam (injectable for fake-timer tests). */
  schedule?: (fn: () => void, ms: number) => void;
}

/**
 * Wrap a sender so a failed batch (5xx or network error) is retried with **jittered, capped** exponential
 * backoff behind a **circuit breaker** (S13, harvests flaw #1). The original backed off `baseMs · 2^n` with no
 * jitter and no cap — so after an outage every tab retried on the exact same boundary and hit the recovering
 * backend in lockstep (a self-inflicted DDoS). Three fixes: FULL JITTER (`random · ceil`) decorrelates clients,
 * a CAP bounds the worst-case wait, and the BREAKER means a down backend sees one probe instead of a flood.
 */
export function withRetry(send: SendFn, cfg: RetryConfig = {}): SendFn {
  const baseMs = cfg.baseMs ?? 1000;
  const maxAttempts = cfg.maxAttempts ?? 10;
  const maxDelayMs = cfg.maxDelayMs ?? 30_000;
  const jitter = cfg.jitter ?? Math.random;
  const breaker = cfg.breaker ?? new CircuitBreaker();
  const schedule = cfg.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
  const attempt = (batch: EventEnvelope[], n: number): Promise<boolean> => {
    // Circuit open → fail fast; the batch stays in the caller's overflow queue for a later flush.
    if (!breaker.canRequest()) return Promise.resolve(false);
    return send(batch)
      .catch(() => false)
      .then((ok) => {
        if (ok) {
          breaker.onSuccess();
          return true;
        }
        breaker.onFailure();
        if (n >= maxAttempts) return false;
        // Full jitter over a capped exponential ceiling: delay ∈ [0, min(cap, base·2^n)).
        const ceil = Math.min(maxDelayMs, baseMs * 2 ** n);
        const delay = jitter() * ceil;
        return new Promise<boolean>((resolve) => schedule(() => resolve(attempt(batch, n + 1)), delay));
      });
  };
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
  /** Persist the pending queue here so events survive a reload / backend outage. */
  storage?: SafeStorage;
  /** Cap on buffered events; oldest are dropped past this. Default 1000. */
  maxQueue?: number;
}

/** The batching transport: a queue drained by the three triggers above. */
export class BatchTransport implements Transport {
  private queue: EventEnvelope[] = [];
  private readonly flushAt: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly send: SendFn;
  private readonly beacon: BeaconFn | undefined;
  private readonly storage: SafeStorage | undefined;
  private readonly maxQueue: number;

  constructor(cfg: BatchTransportConfig) {
    this.send = cfg.send;
    this.beacon = cfg.beacon;
    this.flushAt = cfg.flushAt ?? 10;
    this.storage = cfg.storage;
    this.maxQueue = cfg.maxQueue ?? 1000;
    this.queue = this.load(); // rehydrate anything left over from a previous page load
    const interval = cfg.flushIntervalMs ?? 5000;
    this.timer = setInterval(() => this.flush(), interval);
  }

  enqueue(event: EventEnvelope): void {
    this.queue.push(event);
    // Overflow: when a backend outage lets the queue grow past the cap, drop the OLDEST events. Newer data is
    // usually more valuable, and an unbounded queue would eventually blow the localStorage quota.
    if (this.queue.length > this.maxQueue) this.queue.splice(0, this.queue.length - this.maxQueue);
    this.persist();
    if (this.queue.length >= this.flushAt) this.flush();
  }

  flush(): void {
    if (this.queue.length === 0) return;
    // Drain the queue synchronously BEFORE the async send, so a second flush (timer + size firing together)
    // can never send the same events twice.
    const batch = this.queue;
    this.queue = [];
    this.persist();
    void this.send(batch).catch(() => {});
  }

  private persist(): void {
    if (!this.storage) return;
    this.storage.set(QUEUE_KEY, JSON.stringify(this.queue));
  }

  private load(): EventEnvelope[] {
    if (!this.storage) return [];
    const raw = this.storage.get(QUEUE_KEY);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as EventEnvelope[]) : [];
    } catch {
      return []; // corrupt persisted queue is discarded, never thrown
    }
  }

  /** On a dying page: drain synchronously, prefer sendBeacon, fall back to a keepalive fetch. */
  flushOnUnload(): void {
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    this.persist();
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
