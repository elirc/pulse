/**
 * The trend query language (S05) — a CLOSED abstract syntax tree, not a string. This is the single most
 * important security decision in the analytics query path: users compose queries from a fixed vocabulary
 * (allowlisted metrics, intervals, and operators; property names and values as data), and NOTHING they type is
 * ever concatenated into SQL. The compiler (sql.ts) turns this AST into parameterized SQL; the interpreter
 * (compute.ts) evaluates it in memory for tests. Both consume the same validated spec, so they can't drift.
 *
 * (This reuses Tracer S10's allowlist lesson verbatim: a query builder over user input is only as safe as its
 * grammar is closed.)
 */
import { z } from "zod";

/** total = count(*); unique = count(distinct person). "unique users" is the expensive verb of analytics. */
export const MetricSchema = z.enum(["total", "unique"]);
export type Metric = z.infer<typeof MetricSchema>;

export const IntervalSchema = z.enum(["day", "week", "month"]);
export type Interval = z.infer<typeof IntervalSchema>;

/** The allowlisted filter operators. Anything not here cannot be expressed, let alone injected. */
export const FilterOpSchema = z.enum(["eq", "neq", "contains", "gt", "gte", "lt", "lte"]);
export type FilterOp = z.infer<typeof FilterOpSchema>;

export const FilterSchema = z.object({
  property: z.string().min(1).max(200),
  op: FilterOpSchema,
  value: z.union([z.string(), z.number(), z.boolean()]),
});
export type Filter = z.infer<typeof FilterSchema>;

export const TrendSpecSchema = z.object({
  /** Event name to count; omit for all events. */
  event: z.string().min(1).max(200).optional(),
  metric: MetricSchema.default("total"),
  interval: IntervalSchema.default("day"),
  filters: z.array(FilterSchema).max(20).default([]),
  /** A property to break the series down by (GROUP BY), top-N + "Other". */
  breakdown: z.string().min(1).max(200).optional(),
  /** Lookback window in days. */
  days: z.number().int().min(1).max(365).default(30),
  /** How many breakdown buckets to keep before folding the rest into "Other". */
  topN: z.number().int().min(1).max(50).default(10),
});
export type TrendSpec = z.infer<typeof TrendSpecSchema>;

/** The label for the folded-away long tail of a breakdown. */
export const OTHER_BUCKET = "Other";
