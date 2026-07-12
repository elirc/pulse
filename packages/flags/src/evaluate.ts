/**
 * Flag evaluation (S14) — the authoritative, server-side evaluator. Pure: given a flag, an evaluation context,
 * and a bucketing function, it returns the variant and WHY. The `bucket` fn is injected (shared's deterministic
 * bucketer in production) so this core is testable with a fake, and so the SDK can supply its own identical
 * bucketer — the whole point is that every evaluator agrees without coordination.
 */
import { matchesAll, type Filter } from "@pulse/insights";
import { controlVariant, type FlagSpec } from "./spec";

export interface FlagContext {
  distinctId: string;
  properties: Record<string, unknown>;
}

export type FlagReason = "disabled" | "not_targeted" | "out_of_rollout" | "rollout";

export interface FlagEvaluation {
  flagKey: string;
  variant: string;
  reason: FlagReason;
}

/** Deterministic bucketer: (flagKey, distinctId) → [0,1). Salts let rollout and variant be independent draws. */
export type BucketFn = (flagKey: string, distinctId: string, salt?: string) => number;

/**
 * Evaluate a flag for a context. Order: disabled → off; targeting predicate fails → control; rollout gate
 * (independent salt) → control if outside; else pick a variant by a SEPARATE weighted draw. Using distinct salts
 * for the rollout gate and the variant split keeps them uncorrelated — a user just inside the rollout isn't
 * pushed toward a particular variant.
 */
export function evaluateFlag(flag: FlagSpec, ctx: FlagContext, bucket: BucketFn): FlagEvaluation {
  const control = controlVariant(flag);
  if (!flag.enabled) return { flagKey: flag.key, variant: control, reason: "disabled" };

  if (flag.targeting.length > 0 && !matchesAll(ctx.properties, flag.targeting as Filter[])) {
    return { flagKey: flag.key, variant: control, reason: "not_targeted" };
  }

  const rolloutDraw = bucket(flag.key, ctx.distinctId, "rollout");
  if (rolloutDraw >= flag.rolloutPercentage / 100) {
    return { flagKey: flag.key, variant: control, reason: "out_of_rollout" };
  }

  return { flagKey: flag.key, variant: pickVariant(flag, ctx.distinctId, bucket), reason: "rollout" };
}

/** Weighted variant selection off an independent bucket draw. */
function pickVariant(flag: FlagSpec, distinctId: string, bucket: BucketFn): string {
  const total = flag.variants.reduce((s, v) => s + v.weight, 0);
  if (total <= 0) return controlVariant(flag);
  const draw = bucket(flag.key, distinctId, "variant") * total;
  let acc = 0;
  for (const v of flag.variants) {
    acc += v.weight;
    if (draw < acc) return v.key;
  }
  return flag.variants[flag.variants.length - 1].key; // fp guard
}
