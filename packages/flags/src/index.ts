/**
 * @pulse/flags — feature flags & experiments (S14). Pure cores: the flag AST (spec), deterministic evaluation
 * (evaluate), and — added across the sprint — experiment significance math (results). No DB, no network; the
 * bucketer is injected so server and SDK evaluators agree without coordination.
 */
export * from "./spec";
export * from "./evaluate";
export * from "./results";
