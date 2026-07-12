/**
 * Pipeline health (S15) — the four numbers that ARE the product's health, and a rule for turning them into a
 * status. Operating a data pipeline means watching: how fast events arrive (ingest rate), how far behind the
 * consumer is (lag = backlog not yet stored), how many events are stuck (DLQ depth), and how long inserts take
 * (batch p95). This assesses them against thresholds into healthy/degraded/critical, so an on-call sees a verdict
 * with reasons, not four raw gauges to interpret under pressure.
 */
export interface PipelineSample {
  /** Events accepted per second at ingest (the customer-visible throughput). */
  ingestRatePerSec: number;
  /** Backlog: stream entries delivered-or-pending but not yet stored. The lag that matters. */
  consumerLag: number;
  /** Dead-letter depth: events that failed processing and are parked. */
  dlqDepth: number;
  /** p95 of the consumer's insert batch latency, ms. */
  insertBatchP95Ms: number;
}

export interface PipelineThresholds {
  lagWarn: number;
  lagCrit: number;
  dlqWarn: number;
  dlqCrit: number;
  insertP95WarnMs: number;
  insertP95CritMs: number;
}

export const DEFAULT_PIPELINE_THRESHOLDS: PipelineThresholds = {
  lagWarn: 50_000,
  lagCrit: 250_000,
  dlqWarn: 1,
  dlqCrit: 1_000,
  insertP95WarnMs: 500,
  insertP95CritMs: 2_000,
};

export type PipelineStatus = "healthy" | "degraded" | "critical";

export interface PipelineHealth {
  status: PipelineStatus;
  reasons: string[];
}

/** Turn a sample into a status + the specific reasons — the worst signal sets the overall status. */
export function assessPipeline(
  s: PipelineSample,
  t: PipelineThresholds = DEFAULT_PIPELINE_THRESHOLDS,
): PipelineHealth {
  const reasons: string[] = [];
  let status: PipelineStatus = "healthy";
  const escalate = (to: PipelineStatus): void => {
    const rank: Record<PipelineStatus, number> = { healthy: 0, degraded: 1, critical: 2 };
    if (rank[to] > rank[status]) status = to;
  };

  if (s.consumerLag >= t.lagCrit) {
    escalate("critical");
    reasons.push(`consumer lag ${s.consumerLag} ≥ ${t.lagCrit} (critical)`);
  } else if (s.consumerLag >= t.lagWarn) {
    escalate("degraded");
    reasons.push(`consumer lag ${s.consumerLag} ≥ ${t.lagWarn} (warn)`);
  }

  if (s.dlqDepth >= t.dlqCrit) {
    escalate("critical");
    reasons.push(`DLQ depth ${s.dlqDepth} ≥ ${t.dlqCrit} (critical)`);
  } else if (s.dlqDepth >= t.dlqWarn) {
    escalate("degraded");
    reasons.push(`DLQ depth ${s.dlqDepth} ≥ ${t.dlqWarn} (warn)`);
  }

  if (s.insertBatchP95Ms >= t.insertP95CritMs) {
    escalate("critical");
    reasons.push(`insert p95 ${s.insertBatchP95Ms}ms ≥ ${t.insertP95CritMs}ms (critical)`);
  } else if (s.insertBatchP95Ms >= t.insertP95WarnMs) {
    escalate("degraded");
    reasons.push(`insert p95 ${s.insertBatchP95Ms}ms ≥ ${t.insertP95WarnMs}ms (warn)`);
  }

  if (reasons.length === 0) reasons.push("all signals within thresholds");
  return { status, reasons };
}
