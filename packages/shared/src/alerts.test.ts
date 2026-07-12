import { describe, it, expect } from "vitest";
import { evaluateAlerts, DEFAULT_ALERT_THRESHOLDS, type AlertInput } from "./alerts";

const healthy: AlertInput = { consumerLag: 100, dlqGrowthPerMin: 0, lossRatio: 0, chDiskFreeRatio: 0.6 };

describe("alert evaluation (S15)", () => {
  it("a healthy snapshot fires nothing", () => {
    expect(evaluateAlerts(healthy)).toEqual([]);
  });

  it("lag past the SLO burn line pages crit", () => {
    const a = evaluateAlerts({ ...healthy, consumerLag: DEFAULT_ALERT_THRESHOLDS.lagBurn });
    expect(a.map((x) => x.name)).toContain("lag_slo_burn");
    expect(a[0].severity).toBe("crit");
  });

  it("DLQ GROWTH (not depth) fires — a rising DLQ is an active incident", () => {
    expect(evaluateAlerts({ ...healthy, dlqGrowthPerMin: 50 }).map((x) => x.name)).toContain("dlq_growth");
  });

  it("any loss above tolerance pages — including over-count (negative ratio)", () => {
    expect(evaluateAlerts({ ...healthy, lossRatio: 0.001 }).map((x) => x.name)).toContain("event_loss");
    expect(evaluateAlerts({ ...healthy, lossRatio: -0.001 }).map((x) => x.name)).toContain("event_loss");
  });

  it("CH disk headroom warns then crits as it drains", () => {
    expect(evaluateAlerts({ ...healthy, chDiskFreeRatio: 0.2 }).find((x) => x.name === "ch_disk")?.severity).toBe("warn");
    expect(evaluateAlerts({ ...healthy, chDiskFreeRatio: 0.05 }).find((x) => x.name === "ch_disk")?.severity).toBe("crit");
  });

  it("multiple simultaneous failures all fire", () => {
    const a = evaluateAlerts({ consumerLag: 500_000, dlqGrowthPerMin: 100, lossRatio: 0.01, chDiskFreeRatio: 0.05 });
    expect(a).toHaveLength(4);
  });
});
