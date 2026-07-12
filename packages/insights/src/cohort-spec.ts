/**
 * Cohort definitions (S09) — ONE AST grammar for BOTH kinds of cohort, so we don't build two filter languages.
 *   • property cohort: a person is in if their properties match a predicate. Cheap → compiled live into queries.
 *   • behavioral cohort: a person is in if they did event X at least N times in a window. Expensive (a scan per
 *     evaluation) and reused by many queries → materialized on a schedule (ADR-0008).
 *
 * Property predicates reuse the trend/funnel filter grammar (third appearance of the pattern) — a behavioral
 * definition is just "did this event" layered on the same predicate vocabulary.
 */
import { z } from "zod";
import { FilterSchema } from "./spec";

export const PropertyCohortSchema = z.object({
  kind: z.literal("property"),
  filters: z.array(FilterSchema).min(1).max(20),
});

export const BehavioralCohortSchema = z.object({
  kind: z.literal("behavioral"),
  event: z.string().min(1).max(200),
  /** Event-level filters on the behavioral event. */
  filters: z.array(FilterSchema).max(20).default([]),
  minCount: z.number().int().min(1).default(1),
  windowDays: z.number().int().min(1).max(365).default(30),
});

export const CohortSpecSchema = z.discriminatedUnion("kind", [PropertyCohortSchema, BehavioralCohortSchema]);
export type CohortSpec = z.infer<typeof CohortSpecSchema>;
export type PropertyCohort = z.infer<typeof PropertyCohortSchema>;
export type BehavioralCohort = z.infer<typeof BehavioralCohortSchema>;
