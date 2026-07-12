import { describe, it, expect } from "vitest";
import { assessQuota, SOFT_LIMIT_RATIO } from "./quota";

describe("per-project quota metering (S15)", () => {
  it("ok well below the allowance", () => {
    expect(assessQuota(100, 1000).state).toBe("ok");
  });

  it("soft at the soft-limit ratio (a banner, still accepting)", () => {
    expect(assessQuota(SOFT_LIMIT_RATIO * 1000, 1000).state).toBe("soft");
    expect(assessQuota(999, 1000).state).toBe("soft");
  });

  it("hard at or over the allowance (429 territory)", () => {
    expect(assessQuota(1000, 1000).state).toBe("hard");
    expect(assessQuota(1500, 1000).state).toBe("hard");
  });

  it("a zero allowance is immediately hard, without dividing by zero", () => {
    const q = assessQuota(1, 0);
    expect(q.ratio).toBe(Infinity);
    expect(q.state).toBe("hard");
  });
});
