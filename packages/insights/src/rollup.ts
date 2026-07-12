/**
 * Rollup routing (S12). Some trend queries can be answered from the daily rollup (events_daily) instead of the
 * raw firehose — but ONLY the ones the audit found hot-and-stable, and ONLY when the rollup would return the
 * EXACT same answer. Silent routing that ever disagrees with raw destroys analyst trust permanently, so
 * eligibility is explicit and narrow, and parity goldens prove rollup == raw for eligible shapes.
 *
 * Eligible = a plain daily count/unique for one event, no property filters, no breakdown. Anything with a
 * filter or breakdown or a non-day interval stays on the raw path (the rollup can't precompute arbitrary
 * filters — the S05 lesson).
 */
import type { TrendSpec } from "./spec";
import type { CompiledChQuery } from "./sql-clickhouse";

export function isRollupEligible(spec: TrendSpec): boolean {
  return (
    spec.interval === "day" &&
    spec.filters.length === 0 &&
    spec.breakdown === undefined &&
    spec.event !== undefined // rollup is keyed by event name
  );
}

/** Compile an eligible trend to read the pre-aggregated daily rollup. Same shape of result as the raw compiler. */
export function compileTrendRollup(spec: TrendSpec, projectId: string): CompiledChQuery {
  const params: Record<string, unknown> = {};
  let n = 0;
  const bind = (value: unknown, type: string): string => {
    const name = `p${++n}`;
    params[name] = value;
    return `{${name}:${type}}`;
  };
  const metricExpr = spec.metric === "unique" ? "uniqMerge(uniqs)" : "sumMerge(count)";
  const text =
    `SELECT formatDateTime(day, '%Y-%m-%d') AS bucket, ${metricExpr} AS value FROM events_daily ` +
    `WHERE projectId = ${bind(projectId, "String")} AND name = ${bind(spec.event, "String")} ` +
    `AND day >= today() - ${bind(spec.days, "UInt16")} ` +
    `GROUP BY day ORDER BY day`;
  return { text, params };
}

/** Which path serves a query — for the transparent-routing debug header. */
export function routeTrend(spec: TrendSpec): "rollup" | "raw" {
  return isRollupEligible(spec) ? "rollup" : "raw";
}
