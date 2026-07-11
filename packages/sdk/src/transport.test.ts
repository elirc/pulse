import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BatchTransport, withRetry, type SendFn } from "./transport";
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
