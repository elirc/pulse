/**
 * Alert evaluation (S15). Metrics become dashboards (S15 commit 1); alerts are the metrics that page you. This
 * turns a snapshot of pipeline signals into firing alerts with severity. The signals are chosen so each one
 * catches a distinct failure the others miss: lag catches a slow/stalled consumer, DLQ GROWTH RATE catches a
 * poison-pill storm (a high-but-flat DLQ is a known backlog; a rising one is an active incident), the loss ratio
 * catches silent drops the other three can't see, and CH disk headroom catches the slow-motion outage that ends
 * with writes failing. Pure, so alert rules are unit-testable — an alert rule you can't test will page you at 3am
 * for the wrong reason.
 */
export interface AlertInput {
  /** Consumer backlog (lag). */
  consumerLag: number;
  /** DLQ entries added per minute — the RATE, not the depth. */
  dlqGrowthPerMin: number;
  /** Event-loss ratio from the hourly reconciliation. */
  lossRatio: number;
  /** ClickHouse free-disk fraction (0..1). */
  chDiskFreeRatio: number;
}

export interface AlertThresholds {
  lagBurn: number;
  dlqGrowthPerMin: number;
  lossRatio: number;
  chDiskFreeWarn: number;
  chDiskFreeCrit: number;
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  lagBurn: 250_000,
  dlqGrowthPerMin: 10,
  lossRatio: 0.0001,
  chDiskFreeWarn: 0.25,
  chDiskFreeCrit: 0.1,
};

export type AlertSeverity = "warn" | "crit";

export interface Alert {
  name: string;
  severity: AlertSeverity;
  message: string;
}

export function evaluateAlerts(m: AlertInput, t: AlertThresholds = DEFAULT_ALERT_THRESHOLDS): Alert[] {
  const alerts: Alert[] = [];

  if (m.consumerLag >= t.lagBurn) {
    alerts.push({ name: "lag_slo_burn", severity: "crit", message: `consumer lag ${m.consumerLag} ≥ ${t.lagBurn}` });
  }
  if (m.dlqGrowthPerMin >= t.dlqGrowthPerMin) {
    alerts.push({
      name: "dlq_growth",
      severity: "crit",
      message: `DLQ growing ${m.dlqGrowthPerMin}/min ≥ ${t.dlqGrowthPerMin} — poison-pill storm`,
    });
  }
  if (Math.abs(m.lossRatio) > t.lossRatio) {
    alerts.push({
      name: "event_loss",
      severity: "crit",
      message: `event-loss ratio ${(m.lossRatio * 100).toFixed(4)}% exceeds tolerance`,
    });
  }
  if (m.chDiskFreeRatio <= t.chDiskFreeCrit) {
    alerts.push({ name: "ch_disk", severity: "crit", message: `ClickHouse disk ${(m.chDiskFreeRatio * 100).toFixed(0)}% free (critical)` });
  } else if (m.chDiskFreeRatio <= t.chDiskFreeWarn) {
    alerts.push({ name: "ch_disk", severity: "warn", message: `ClickHouse disk ${(m.chDiskFreeRatio * 100).toFixed(0)}% free (warn)` });
  }

  return alerts;
}
