/**
 * @pulse/insights — the trend query language (S05): a closed AST (spec.ts), an in-memory interpreter
 * (compute.ts, the golden-fixture oracle), and a parameterized SQL compiler (sql.ts). Pure and DB-free.
 */
export * from "./spec";
export * from "./funnel-spec";
export * from "./funnel-naive";
export * from "./funnel";
export * from "./funnel-sql";
export * from "./retention";
export * from "./cohort-spec";
export * from "./cohort";
export * from "./compute";
export * from "./sql";
export * from "./sql-clickhouse";
export * from "./rollup";
export * from "./cardinality-guard";
export * from "./sampling";
export * from "./pivot";
