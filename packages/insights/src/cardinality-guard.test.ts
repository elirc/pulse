import { describe, it, expect } from "vitest";
import { cardinalityGuard, HIGH_CARDINALITY_THRESHOLD, GUARDED_TOP_N } from "./cardinality-guard";

describe("cardinality guard (S12)", () => {
  it("passes a low-cardinality breakdown through unchanged", () => {
    const g = cardinalityGuard("$browser", 5, 10);
    expect(g.guarded).toBe(false);
    expect(g.effectiveTopN).toBe(10);
    expect(g.notice).toBeUndefined();
  });

  it("forces top-N + Other + a notice on a high-cardinality breakdown", () => {
    const g = cardinalityGuard("$url", 250_000, 50);
    expect(g.guarded).toBe(true);
    expect(g.effectiveTopN).toBe(GUARDED_TOP_N); // capped
    expect(g.notice).toContain("$url");
    expect(g.notice).toContain("Other");
  });

  it("the threshold is the boundary", () => {
    expect(cardinalityGuard("p", HIGH_CARDINALITY_THRESHOLD, 30).guarded).toBe(false);
    expect(cardinalityGuard("p", HIGH_CARDINALITY_THRESHOLD + 1, 30).guarded).toBe(true);
  });
});
