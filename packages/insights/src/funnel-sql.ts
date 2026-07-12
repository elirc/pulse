/**
 * [S] Funnel → ClickHouse `windowFunnel()` (S08). One query: `windowFunnel(windowSec)(ts, cond1, cond2, …)`
 * returns, per person, the length of the longest matching prefix of the step sequence; the outer aggregate
 * counts how many reached each level. Sequence matching happens INSIDE the engine, in one scan over
 * ORDER BY-local rows — the same shape as the single-pass in-memory version, at columnar speed.
 *
 * Closed-AST safety as ever: step events and filter values are bound params; only the step count (structure) is
 * inlined, and it comes from the validated spec.
 */
import type { FunnelSpec, FunnelStep } from "./funnel-spec";
import type { CompiledChQuery } from "./sql-clickhouse";

function stepCondition(step: FunnelStep, bind: (v: unknown, t: string) => string): string {
  const parts = [`name = ${bind(step.event, "String")}`];
  for (const f of step.filters) {
    const key = `JSONExtractString(props, ${bind(f.property, "String")})`;
    if (f.op === "eq") parts.push(`${key} = ${bind(String(f.value), "String")}`);
    else if (f.op === "neq") parts.push(`${key} != ${bind(String(f.value), "String")}`);
    else if (f.op === "contains") parts.push(`position(${key}, ${bind(String(f.value), "String")}) > 0`);
    else parts.push(`toFloat64OrNull(${key}) ${OP[f.op]} ${bind(Number(f.value), "Float64")}`);
  }
  return parts.join(" AND ");
}

const OP: Record<string, string> = { gt: ">", gte: ">=", lt: "<", lte: "<=" };

export function compileFunnelClickhouse(spec: FunnelSpec, projectId: string): CompiledChQuery {
  const params: Record<string, unknown> = {};
  let n = 0;
  const bind = (value: unknown, type: string): string => {
    const name = `p${++n}`;
    params[name] = value;
    return `{${name}:${type}}`;
  };

  const windowSec = spec.windowDays * 24 * 60 * 60;
  const conds = spec.steps.map((s) => stepCondition(s, bind)).join(", ");
  const person = "if(personId != '', personId, distinctId)";
  const levelCounts = spec.steps.map((_, i) => `countIf(level >= ${i + 1}) AS step${i + 1}`).join(", ");

  const text =
    `SELECT ${levelCounts} FROM (` +
    `SELECT ${person} AS person, windowFunnel(${windowSec})(ts, ${conds}) AS level ` +
    `FROM events ` +
    `WHERE projectId = ${bind(projectId, "String")} AND ts >= now() - toIntervalDay(${bind(spec.days, "UInt16")}) ` +
    `GROUP BY person)`;
  return { text, params };
}
