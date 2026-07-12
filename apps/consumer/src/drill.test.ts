import { describe, it, expect } from "vitest";
import { InMemoryEventStream } from "@pulse/stream";
import { assessPipeline, evaluateAlerts, reconcileLoss, type QueuedEvent } from "@pulse/shared";
import { InMemoryEventStore, type StorableEvent } from "./store";
import { GracefulShutdown, runConsumerLoop } from "./shutdown";

/**
 * Incident drill (S15) — a deterministic reproduction of the "stalled consumer" incident, run in CI so the
 * recovery invariants are pinned. It follows the runbook end to end: events accepted → consumer STALLED → the
 * backlog grows and the lag SLO alert fires → consumers scale and DRAIN → verify ZERO LOSS via the accounting.
 * The staging version drives real loadgen traffic; this models it with the real stream/store/shutdown/accounting
 * cores so a regression in any of them fails the build.
 */
describe("stalled-consumer incident drill (S15)", () => {
  it("stall grows the backlog and fires the lag alert; drain recovers with zero loss", async () => {
    const stream = new InMemoryEventStream<QueuedEvent>();
    const store = new InMemoryEventStore();
    const GROUP = "inserters";
    await stream.ensureGroup(GROUP);

    // Phase 1 — ACCEPT: ingest takes N events (the 202s). The consumer is stalled, so nothing is stored yet.
    // N is past the critical lag / SLO-burn thresholds (250k) so the incident actually trips them.
    const N = 300_000;
    for (let i = 0; i < N; i++) {
      await stream.add({
        uuid: `e-${i}`,
        projectId: "demo",
        distinctId: "u",
        name: "$pageview",
        props: {},
        ts: "2026-07-11T00:00:00Z",
        ingestedAt: "2026-07-11T00:00:00Z",
      });
    }

    // The backlog is now the full accepted count; the pipeline is critical and the lag alert fires.
    const lagWhileStalled = await stream.depth();
    expect(lagWhileStalled).toBe(N);
    const health = assessPipeline({ ingestRatePerSec: 5000, consumerLag: lagWhileStalled, dlqDepth: 0, insertBatchP95Ms: 120 });
    expect(health.status).toBe("critical");
    const alerts = evaluateAlerts({ consumerLag: lagWhileStalled, dlqGrowthPerMin: 0, lossRatio: 0, chDiskFreeRatio: 0.6 });
    expect(alerts.map((a) => a.name)).toContain("lag_slo_burn");

    // Phase 2 — RECOVER: scale consumers back up and drain. The graceful loop pulls batches until the backlog is
    // empty, then a drain request stops it cleanly.
    const shutdown = new GracefulShutdown();
    const drainBatch = async (): Promise<number> => {
      const entries = await stream.readNew(GROUP, 5000);
      if (entries.length === 0) {
        shutdown.requestDrain(); // caught up → stop
        return 0;
      }
      const inserted = await store.insertBatch(entries.map((e) => e.data as StorableEvent));
      await stream.ack(GROUP, entries.map((e) => e.id));
      return inserted;
    };
    const result = await runConsumerLoop(drainBatch, shutdown);

    // Phase 3 — VERIFY: every accepted event is stored, and the loss accounting confirms zero loss.
    expect(store.events.length).toBe(N);
    expect(result.processed).toBe(N);
    expect(await stream.depth()).toBe(0);
    const rec = reconcileLoss(N, store.events.length, new Date("2026-07-11T00:00:00Z"), new Date("2026-07-11T01:00:00Z"));
    expect(rec.alarm).toBe(false);
    expect(rec.lost).toBe(0);
  });
});
