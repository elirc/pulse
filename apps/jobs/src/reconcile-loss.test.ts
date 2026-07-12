import { describe, it, expect } from "vitest";
import { runLossReconciliation, type LossReconcilePorts } from "./reconcile-loss";
import type { LossReconciliation } from "@pulse/shared";

function ports(accepted: number, stored: number): { ports: LossReconcilePorts; published: LossReconciliation[] } {
  const published: LossReconciliation[] = [];
  return {
    published,
    ports: {
      acceptedCount: () => Promise.resolve(accepted),
      storedCount: () => Promise.resolve(stored),
      publish: (rec) => {
        published.push(rec);
        return Promise.resolve();
      },
    },
  };
}

const NOW = new Date("2026-07-11T12:00:00Z");

describe("hourly loss reconciliation job (S15)", () => {
  it("reconciles the last hour and publishes a balanced result", async () => {
    const { ports: p, published } = ports(3_600_000, 3_600_000);
    const rec = await runLossReconciliation(p, NOW);
    expect(rec.alarm).toBe(false);
    expect(rec.lost).toBe(0);
    expect(published).toHaveLength(1);
    // The window is the trailing hour.
    expect(rec.windowEnd).toBe(NOW.toISOString());
    expect(rec.windowStart).toBe(new Date(NOW.getTime() - 3_600_000).toISOString());
  });

  it("publishes an alarming reconciliation when the ledger doesn't balance", async () => {
    const { ports: p, published } = ports(3_600_000, 3_500_000); // ~2.8% loss
    const rec = await runLossReconciliation(p, NOW);
    expect(rec.alarm).toBe(true);
    expect(published[0].alarm).toBe(true);
  });
});
