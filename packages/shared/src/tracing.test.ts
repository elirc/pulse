import { describe, it, expect } from "vitest";
import { shouldTrace, traceDurationMs, DEFAULT_TRACE_SAMPLE_RATE, type TraceSpan } from "./tracing";

describe("sampled tracing (S15)", () => {
  it("is deterministic per uuid — same event, same decision (so every stage agrees)", () => {
    for (let i = 0; i < 1000; i++) {
      const uuid = `evt-${i}`;
      expect(shouldTrace(uuid)).toBe(shouldTrace(uuid));
    }
  });

  it("samples roughly the configured fraction across many uuids", () => {
    const N = 100_000;
    let traced = 0;
    for (let i = 0; i < N; i++) if (shouldTrace(`e_${i}`, 0.01)) traced++;
    const rate = traced / N;
    expect(rate).toBeGreaterThan(0.007); // within tolerance of 1%
    expect(rate).toBeLessThan(0.013);
  });

  it("rate 0 traces nothing, rate 1 traces everything", () => {
    expect(shouldTrace("x", 0)).toBe(false);
    expect(shouldTrace("x", 1)).toBe(true);
    expect(DEFAULT_TRACE_SAMPLE_RATE).toBe(0.01);
  });

  it("computes trace duration from the first to last span", () => {
    const spans: TraceSpan[] = [
      { uuid: "a", stage: "ingest", atMs: 1000 },
      { uuid: "a", stage: "stream", atMs: 1005 },
      { uuid: "a", stage: "consumer", atMs: 1040 },
      { uuid: "a", stage: "insert", atMs: 1052 },
    ];
    expect(traceDurationMs(spans)).toBe(52);
    expect(traceDurationMs(spans.slice(0, 1))).toBeNull();
  });
});
