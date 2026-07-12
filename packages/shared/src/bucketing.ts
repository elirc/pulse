/**
 * Deterministic bucketing (S14) — the coordination-free primitive behind flags and experiments.
 * `bucket(flagKey, distinctId)` maps a user to a stable value in [0,1) using a hash, so:
 *   • STICKY without storage — the same (flag, user) always lands in the same bucket, on any evaluator, forever,
 *     with no assignment table and no write on evaluation.
 *   • AGREED across evaluators — the server, the SDK, and a backfill job all compute the identical bucket, so a
 *     user sees one consistent variant everywhere.
 *   • INDEPENDENT across flags — the flagKey is IN the hash input, so bucket(flagA) and bucket(flagB) are
 *     uncorrelated. Omitting it would make every experiment reuse the same split — the subtle bug the property
 *     tests guard against.
 *
 * The `salt` lets one flag draw multiple independent values (e.g. a rollout gate vs. a variant split) without
 * correlation between them. The hash is FNV-1a/32 — cheap, stable, and dependency-free (so the SDK can carry an
 * identical copy in its zero-dep bundle).
 */
const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

/** FNV-1a 32-bit hash of a string → unsigned 32-bit int. */
export function hash32(input: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/** Map (flagKey, distinctId[, salt]) to a stable bucket in [0,1). */
export function bucket(flagKey: string, distinctId: string, salt = ""): number {
  return hash32(`${flagKey}:${salt}:${distinctId}`) / 0x100000000;
}
