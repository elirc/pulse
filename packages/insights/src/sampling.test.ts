import { describe, it, expect } from "vitest";
import { estimateFromSample, formatEstimate, MIN_RELIABLE_OBSERVED } from "./sampling";
import { compileTrendClickhouse } from "./sql-clickhouse";
import { TrendSpecSchema } from "./spec";

describe("sampling estimate + CI (S12)", () => {
  it("scales the observed count by the sample rate", () => {
    expect(estimateFromSample(1240, 0.1).estimate).toBe(12_400);
  });

  it("a larger observed count gives a tighter relative interval", () => {
    const small = estimateFromSample(100, 0.1);
    const large = estimateFromSample(10_000, 0.1);
    expect(large.relativeCi).toBeLessThan(small.relativeCi);
    expect(large.reliable).toBe(true);
  });

  it("flags tiny observed counts as unreliable (normal approx breaks)", () => {
    expect(estimateFromSample(MIN_RELIABLE_OBSERVED - 1, 0.1).reliable).toBe(false);
    expect(estimateFromSample(MIN_RELIABLE_OBSERVED, 0.1).reliable).toBe(true);
  });

  it("formats as ~estimate ±relative%", () => {
    const f = formatEstimate(estimateFromSample(1240, 0.1));
    expect(f).toMatch(/^~12,400 ±\d+%$/);
  });

  it("the SAMPLE clause sits after the table name", () => {
    const { text } = compileTrendClickhouse(TrendSpecSchema.parse({ event: "e" }), "p1", { sampleRate: 0.1 });
    expect(text).toContain("FROM events SAMPLE 0.1 ");
  });
});
