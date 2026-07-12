/**
 * Feature-flag definitions (S14). A flag is a named decision evaluated per user: on/off, or one of several
 * multivariate variants, gated by a percentage rollout and optional property targeting. Targeting REUSES the
 * S09 cohort filter grammar (its fourth consumer) — we do not invent a fourth predicate language.
 *
 * The key design commitment: a flag is evaluated by DETERMINISTIC BUCKETING, not by storing an assignment per
 * user. `hash(flagKey, distinctId)` places a user in a stable bucket in [0,1); rollout and variant are read off
 * that. No assignment table, no write on evaluation, and every evaluator (server, SDK, backfill) agrees.
 */
import { z } from "zod";
import { FilterSchema } from "@pulse/insights";

export const VariantSchema = z.object({
  key: z.string().min(1).max(100),
  /** Relative weight for multivariate split. Weights are normalized; [50,50] and [1,1] behave identically. */
  weight: z.number().min(0).default(1),
});
export type Variant = z.infer<typeof VariantSchema>;

export const FlagSpecSchema = z.object({
  key: z.string().min(1).max(200),
  enabled: z.boolean().default(true),
  /** Fraction of TARGETED users (0..100) who are in the rollout. Below this bucket → the control/off variant. */
  rolloutPercentage: z.number().min(0).max(100).default(100),
  /** Variants in split order. A boolean flag is `[{key:"control"},{key:"test"}]`; the first is the control/off. */
  variants: z.array(VariantSchema).min(1).max(20),
  /** Property predicate (reuses the cohort/trend filter grammar). Empty → everyone is targeted. */
  targeting: z.array(FilterSchema).max(20).default([]),
});
export type FlagSpec = z.infer<typeof FlagSpecSchema>;

/** The control/off variant is, by convention, the FIRST variant — what a non-rolled-out or untargeted user gets. */
export function controlVariant(flag: FlagSpec): string {
  return flag.variants[0].key;
}
