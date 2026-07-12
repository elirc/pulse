import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BatchTransport, withRetry, CircuitBreaker, type SendFn } from "./transport";
import { memoryStorage } from "./storage";
import type { EventEnvelope } from "./types";

const ev = (name = "e"): EventEnvelope => ({ uuid: crypto.randomUUID(), name, distinctId: "u1", props: {}, ts: "t" });

describe("BatchTransport flush triggers (S03)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("flushes on the SIZE trigger", () => {
    const send = vi.fn<SendFn>(() => Promise.resolve(true));
    const t = new BatchTransport({ send, flushAt: 3, flushIntervalMs: 100_000 });
    t.enqueue(ev());
    t.enqueue(ev());
    expect(send).not.toHaveBeenCalled();
    t.enqueue(ev()); // reaches 3 → flush
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toHaveLength(3);
    t.stop();
  });

  it("flushes on the TIME trigger", () => {
    const send = vi.fn<SendFn>(() => Promise.resolve(true));
    const t = new BatchTransport({ send, flushAt: 100, flushIntervalMs: 1000 });
    t.enqueue(ev());
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledOnce();
    t.stop();
  });

  it("does not double-send when triggers coincide (queue drained before send)", () => {
    const send = vi.fn<SendFn>(() => Promise.resolve(true));
    const t = new BatchTransport({ send, flushAt: 2, flushIntervalMs: 1000 });
    t.enqueue(ev());
    t.enqueue(ev()); // size flush empties the queue
    vi.advanceTimersByTime(1000); // time trigger fires on an empty queue → no-op
    expect(send).toHaveBeenCalledOnce();
    t.stop();
  });

  it("does not throw when the backend is down (rejecting send)", () => {
    const send = vi.fn<SendFn>(() => Promise.reject(new Error("500")));
    const t = new BatchTransport({ send, flushAt: 1 });
    expect(() => t.enqueue(ev())).not.toThrow();
    t.stop();
  });
});

describe("BatchTransport persistence + overflow (S03)", () => {
  it("persists the queue and rehydrates it on the next load", () => {
    const storage = memoryStorage();
    const send = vi.fn<SendFn>(() => Promise.resolve(true));
    const t1 = new BatchTransport({ send, flushAt: 100, flushIntervalMs: 100_000, storage });
    t1.enqueue(ev("a"));
    t1.enqueue(ev("b"));
    t1.stop();
    const t2 = new BatchTransport({ send, flushAt: 100, flushIntervalMs: 100_000, storage });
    expect(t2.size()).toBe(2); // survived the "reload"
    t2.stop();
  });

  it("drops the OLDEST events past maxQueue", () => {
    const send = vi.fn<SendFn>(() => Promise.resolve(true));
    const t = new BatchTransport({ send, flushAt: 100, flushIntervalMs: 100_000, maxQueue: 2 });
    t.enqueue(ev("a"));
    t.enqueue(ev("b"));
    t.enqueue(ev("c")); // over cap → 'a' dropped
    expect(t.size()).toBe(2);
    t.stop();
  });
});

describe("BatchTransport unload (S03)", () => {
  it("prefers the beacon on unload, falling back to send when refused", () => {
    const send = vi.fn<SendFn>(() => Promise.resolve(true));
    const okBeacon = vi.fn(() => true);
    const t = new BatchTransport({ send, beacon: okBeacon, flushAt: 100, flushIntervalMs: 100_000 });
    t.enqueue(ev());
    t.flushOnUnload();
    expect(okBeacon).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    t.stop();

    const refusedBeacon = vi.fn(() => false);
    const t2 = new BatchTransport({ send, beacon: refusedBeacon, flushAt: 100, flushIntervalMs: 100_000 });
    t2.enqueue(ev());
    t2.flushOnUnload();
    expect(send).toHaveBeenCalledOnce(); // keepalive fallback
    t2.stop();
  });
});

describe("withRetry backoff (S03)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("retries a failing batch until it succeeds", async () => {
    let n = 0;
    const send = vi.fn<SendFn>(() => Promise.resolve(++n >= 3)); // fail, fail, succeed
    const retry = withRetry(send, { baseMs: 100, maxAttempts: 5 });
    const p = retry([ev()]);
    await vi.advanceTimersByTimeAsync(100); // 1st retry
    await vi.advanceTimersByTimeAsync(200); // 2nd retry (100 * 2^1)
    await expect(p).resolves.toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("gives up after maxAttempts", async () => {
    const send = vi.fn<SendFn>(() => Promise.resolve(false));
    const retry = withRetry(send, { baseMs: 10, maxAttempts: 2 });
    const p = retry([ev()]);
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(20);
    await expect(p).resolves.toBe(false);
    expect(send).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});

describe("withRetry jitter + cap + circuit breaker (S13, harvests flaw #1)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("full jitter scales the delay by the jitter source (decorrelates clients)", async () => {
    let n = 0;
    const send = vi.fn<SendFn>(() => Promise.resolve(++n >= 2)); // fail once, then succeed
    // jitter=0.5 → first delay = 0.5 * min(cap, base·2^0) = 0.5 * 1000 = 500ms.
    const retry = withRetry(send, { baseMs: 1000, jitter: () => 0.5 });
    const p = retry([ev()]);
    await vi.advanceTimersByTimeAsync(499);
    expect(send).toHaveBeenCalledTimes(1); // not yet — delay is 500, not 0
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("caps the backoff ceiling: with jitter=1 the delay never exceeds maxDelayMs", async () => {
    const send = vi.fn<SendFn>(() => Promise.resolve(false));
    // base·2^5 = 32000 would exceed the 5000 cap; jitter=1 makes the delay exactly the ceiling.
    // High-threshold breaker so this test isolates the CAP behaviour (the breaker gets its own test).
    const retry = withRetry(send, {
      baseMs: 1000,
      maxAttempts: 10,
      maxDelayMs: 5000,
      jitter: () => 1,
      breaker: new CircuitBreaker({ threshold: 100 }),
    });
    const p = retry([ev()]);
    // Advance well past the cap several times — every retry must fire within 5000ms.
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toBe(false);
    expect(send).toHaveBeenCalledTimes(11); // initial + 10 retries, none stuck beyond the cap
  });

  it("the breaker opens after the threshold and then fails fast without calling send", async () => {
    const send = vi.fn<SendFn>(() => Promise.resolve(false));
    const breaker = new CircuitBreaker({ threshold: 3, cooldownMs: 30_000 });
    const retry = withRetry(send, { baseMs: 1, maxAttempts: 2, jitter: () => 1, breaker });
    const p = retry([ev()]);
    await vi.advanceTimersByTimeAsync(10);
    await p; // 3 failures (initial + 2 retries) → breaker opens
    expect(breaker.status).toBe("open");
    const callsAfterOpen = send.mock.calls.length;
    // A fresh send while open must fail fast and NOT hit the network.
    await expect(retry([ev()])).resolves.toBe(false);
    expect(send).toHaveBeenCalledTimes(callsAfterOpen);
  });
});

describe("CircuitBreaker (S13)", () => {
  it("closed → open after threshold; half-open after cooldown; closed on probe success", () => {
    let t = 0;
    const b = new CircuitBreaker({ threshold: 2, cooldownMs: 100, now: () => t });
    expect(b.canRequest()).toBe(true);
    b.onFailure();
    b.onFailure(); // hits threshold
    expect(b.status).toBe("open");
    expect(b.canRequest()).toBe(false); // still open, cooldown not elapsed
    t = 100;
    expect(b.canRequest()).toBe(true); // cooldown elapsed → half-open, one probe
    expect(b.canRequest()).toBe(false); // subsequent callers held back while the probe is in flight
    b.onSuccess();
    expect(b.status).toBe("closed");
    expect(b.canRequest()).toBe(true);
  });

  it("a failed probe re-opens the circuit", () => {
    let t = 0;
    const b = new CircuitBreaker({ threshold: 1, cooldownMs: 50, now: () => t });
    b.onFailure(); // opens
    t = 50;
    expect(b.canRequest()).toBe(true); // half-open probe
    b.onFailure(); // probe failed
    expect(b.status).toBe("open");
    expect(b.canRequest()).toBe(false); // re-opened, cooldown restarts
  });
});
