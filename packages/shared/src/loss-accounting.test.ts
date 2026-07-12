import { describe, it, expect } from "vitest";
import { reconcileLoss, LOSS_ALARM_RATIO } from "./loss-accounting";

const W0 = new Date("2026-07-11T00:00:00Z");
const W1 = new Date("2026-07-11T01:00:00Z");

describe("event-loss accounting (S15)", () => {
  it("a balanced ledger reports zero loss, no alarm", () => {
    const r = reconcileLoss(1_000_000, 1_000_000, W0, W1);
    expect(r.lost).toBe(0);
    expect(r.lossRatio).toBe(0);
    expect(r.alarm).toBe(false);
  });

  it("a tiny loss under the tolerance does not alarm", () => {
    const r = reconcileLoss(1_000_000, 1_000_000 - 50, W0, W1); // 0.005% loss
    expect(r.alarm).toBe(false);
    expect(r.lossRatio).toBeLessThan(LOSS_ALARM_RATIO);
  });

  it("loss above the 0.01% tolerance alarms", () => {
    const r = reconcileLoss(1_000_000, 1_000_000 - 500, W0, W1); // 0.05% loss
    expect(r.lost).toBe(500);
    expect(r.alarm).toBe(true);
  });

  it("OVER-count (more stored than accepted) also alarms — a double-count is a ledger imbalance too", () => {
    const r = reconcileLoss(1_000_000, 1_002_000, W0, W1);
    expect(r.lost).toBe(-2000);
    expect(r.alarm).toBe(true);
  });

  it("an empty window is not a divide-by-zero", () => {
    const r = reconcileLoss(0, 0, W0, W1);
    expect(r.lossRatio).toBe(0);
    expect(r.alarm).toBe(false);
  });
});
