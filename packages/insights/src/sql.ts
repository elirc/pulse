/**
 * The trend SQL compiler (S05): TrendSpec → parameterized Postgres. This is pure string-building (no DB), so
 * its output is fully testable. The safety rule it enforces: the ONLY things ever inlined into the SQL text are
 * allowlisted enum values (interval, metric) that zod already validated against a closed set. Every property
 * name and every value the user supplied becomes a bound parameter ($1, $2, …). A user cannot reach the SQL
 * text, so a user cannot inject SQL — the closed AST is what makes that guarantee mechanical rather than
 * hopeful.
 */
import type { Filter, TrendSpec } from "./spec";

export interface CompiledQuery {
  text: string;
  params: unknown[];
}

function filterSql(f: Filter, bind: (v: unknown) => string): string {
  const key = `("props" ->> ${bind(f.property)})`; // property NAME is a bound param, never inlined
  switch (f.op) {
    case "eq":
      return `${key} = ${bind(String(f.value))}`;
    case "neq":
      return `${key} <> ${bind(String(f.value))}`;
    case "contains":
      // exact substring via position() — avoids ILIKE wildcard semantics leaking from the user value
      return `position(${bind(String(f.value))} in ${key}) > 0`;
    case "gt":
      return `${key}::numeric > ${bind(Number(f.value))}`;
    case "gte":
      return `${key}::numeric >= ${bind(Number(f.value))}`;
    case "lt":
      return `${key}::numeric < ${bind(Number(f.value))}`;
    case "lte":
      return `${key}::numeric <= ${bind(Number(f.value))}`;
  }
}

export function compileTrendSql(spec: TrendSpec, projectId: string): CompiledQuery {
  const params: unknown[] = [];
  const bind = (v: unknown): string => {
    params.push(v);
    return `$${params.length}`;
  };

  // interval and metric come from zod enums (closed sets) — safe to inline. Nothing else is.
  const bucketExpr = `to_char(date_trunc('${spec.interval}', "ts"), 'YYYY-MM-DD')`;
  // Unique users count distinct PERSON (S06), not distinctId — one human with two devices is one user. Fall
  // back to distinctId for events that predate identity resolution (null personId).
  const metricExpr =
    spec.metric === "unique" ? `count(distinct coalesce("personId", "distinctId"))` : `count(*)`;

  const where: string[] = [
    `"projectId" = ${bind(projectId)}`,
    `"ts" >= now() - (${bind(spec.days)} || ' days')::interval`,
  ];
  if (spec.event !== undefined) where.push(`"name" = ${bind(spec.event)}`);
  for (const f of spec.filters) where.push(filterSql(f, bind));

  const cols = [`${bucketExpr} AS bucket`];
  const groupBy = ["1"];
  if (spec.breakdown !== undefined) {
    cols.push(`("props" ->> ${bind(spec.breakdown)}) AS label`);
    groupBy.push("2");
  }
  cols.push(`${metricExpr} AS value`);

  const text =
    `SELECT ${cols.join(", ")} FROM "Event" ` +
    `WHERE ${where.join(" AND ")} ` +
    `GROUP BY ${groupBy.join(", ")} ORDER BY 1`;
  return { text, params };
}
