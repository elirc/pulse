/**
 * The trend SQL compiler v2 (S07): the SAME TrendSpec compiles to ClickHouse SQL. This is where S05's decision
 * to persist query DEFINITIONS pays off — a hundred saved insights migrate to the new engine by swapping the
 * compiler, not the data. Same closed-AST safety: only zod enums are inlined; everything user-supplied is a
 * bound ClickHouse query parameter (`{name:Type}`), so injection is structurally impossible.
 *
 * Two things change with the engine:
 *   • Approximate distinct. `uniq()` is a HyperLogLog estimate — cheap at scale, with a documented error bound
 *     (~0.5% relative). `uniqExact()` is available when exactness is worth the cost. This is approximation as an
 *     engineering CONTRACT: bounded error, documented, opt-out available.
 *   • JSON access. props is a String column; filters read it with `JSONExtractString(props, key)`.
 */
import type { Filter, TrendSpec } from "./spec";

export interface CompiledChQuery {
  text: string;
  /** ClickHouse named query params: { p1: value, ... }. */
  params: Record<string, unknown>;
}

export interface ChCompileOptions {
  /** Use uniqExact instead of the approximate uniq for the unique metric. Default false (approximate). */
  exact?: boolean;
  /** Restrict to a cohort's members (S09): the resolved personIds. Adds `AND person IN (…)`. */
  cohortMembers?: string[];
  /** Sample fraction (S12): 0.1 = read a 10% sample. Adds `SAMPLE 0.1`; the caller scales + CIs the result. */
  sampleRate?: number;
}

/** Relative error bound of ClickHouse `uniq()` (HyperLogLog), documented for the golden-parity tolerance. */
export const UNIQ_RELATIVE_ERROR = 0.005;

function bucketExpr(interval: TrendSpec["interval"]): string {
  switch (interval) {
    case "month":
      return "formatDateTime(toStartOfMonth(ts), '%Y-%m')";
    case "week":
      return "formatDateTime(toStartOfWeek(ts, 1), '%Y-%m-%d')"; // mode 1 = week starts Monday
    case "day":
      return "formatDateTime(toStartOfDay(ts), '%Y-%m-%d')";
  }
}

export function compileTrendClickhouse(
  spec: TrendSpec,
  projectId: string,
  opts: ChCompileOptions = {},
): CompiledChQuery {
  const params: Record<string, unknown> = {};
  let n = 0;
  const bind = (value: unknown, type: string): string => {
    const name = `p${++n}`;
    params[name] = value;
    return `{${name}:${type}}`;
  };

  const personExpr = "if(personId != '', personId, distinctId)";
  const metricExpr =
    spec.metric === "unique" ? `${opts.exact ? "uniqExact" : "uniq"}(${personExpr})` : "count()";

  const where: string[] = [
    `projectId = ${bind(projectId, "String")}`,
    `ts >= now() - toIntervalDay(${bind(spec.days, "UInt16")})`,
  ];
  if (spec.event !== undefined) where.push(`name = ${bind(spec.event, "String")}`);
  for (const f of spec.filters) where.push(filterCh(f, bind));
  // Cohort filter (S09): restrict to the resolved member personIds. (The membership itself is materialized in
  // Postgres and resolved app-side; at scale a CH-side membership table or dictionary replaces the IN-list.)
  if (opts.cohortMembers) where.push(`${personExpr} IN ${bind(opts.cohortMembers, "Array(String)")}`);

  const cols = [`${bucketExpr(spec.interval)} AS bucket`];
  const groupBy = ["1"];
  if (spec.breakdown !== undefined) {
    cols.push(`JSONExtractString(props, ${bind(spec.breakdown, "String")}) AS label`);
    groupBy.push("2");
  }
  cols.push(`${metricExpr} AS value`);

  // SAMPLE must sit right after the table name. The sample rate is a validated number, safe to inline.
  const sample = opts.sampleRate && opts.sampleRate > 0 && opts.sampleRate < 1 ? ` SAMPLE ${opts.sampleRate}` : "";
  const text =
    `SELECT ${cols.join(", ")} FROM events${sample} ` +
    `WHERE ${where.join(" AND ")} ` +
    `GROUP BY ${groupBy.join(", ")} ORDER BY 1`;
  return { text, params };
}

function filterCh(f: Filter, bind: (v: unknown, t: string) => string): string {
  const key = `JSONExtractString(props, ${bind(f.property, "String")})`;
  switch (f.op) {
    case "eq":
      return `${key} = ${bind(String(f.value), "String")}`;
    case "neq":
      return `${key} != ${bind(String(f.value), "String")}`;
    case "contains":
      return `position(${key}, ${bind(String(f.value), "String")}) > 0`;
    case "gt":
      return `toFloat64OrNull(${key}) > ${bind(Number(f.value), "Float64")}`;
    case "gte":
      return `toFloat64OrNull(${key}) >= ${bind(Number(f.value), "Float64")}`;
    case "lt":
      return `toFloat64OrNull(${key}) < ${bind(Number(f.value), "Float64")}`;
    case "lte":
      return `toFloat64OrNull(${key}) <= ${bind(Number(f.value), "Float64")}`;
  }
}
