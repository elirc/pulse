/**
 * SDK-local flag evaluation (S14). Flags evaluate IN THE BROWSER with no network per check — the SDK fetches a
 * payload of definitions once, then buckets locally. This file carries a byte-for-byte copy of the server's
 * FNV-1a+fmix32 bucketer and a minimal predicate matcher: it MUST agree with @pulse/shared's `bucket`, or a user
 * would see one variant in the SDK and be analyzed under another. A parity test pins that agreement.
 *
 * Why a copy and not an import? The SDK is a zero-dep bundle; pulling @pulse/shared (zod, etc.) would blow the
 * budget. The cost of the copy is the parity test — a fair trade.
 */
export interface FlagVariant {
  key: string;
  weight: number;
}
export interface FlagFilter {
  property: string;
  op: "eq" | "neq" | "contains" | "gt" | "gte" | "lt" | "lte";
  value: unknown;
}
export interface FlagPayload {
  key: string;
  enabled: boolean;
  rolloutPercentage: number;
  variants: FlagVariant[];
  targeting: FlagFilter[];
}

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

/** MUST match @pulse/shared hash32 exactly (FNV-1a + murmur3 fmix32). Pinned by a parity test. */
function hash32(input: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function bucket(flagKey: string, distinctId: string, salt = ""): number {
  return hash32(`${flagKey}:${salt}:${distinctId}`) / 0x100000000;
}

function matches(props: Record<string, unknown>, filters: FlagFilter[]): boolean {
  return filters.every((f) => {
    const v = props[f.property];
    switch (f.op) {
      case "eq":
        return String(v) === String(f.value);
      case "neq":
        return String(v) !== String(f.value);
      case "contains":
        return String(v).includes(String(f.value));
      case "gt":
        return Number(v) > Number(f.value);
      case "gte":
        return Number(v) >= Number(f.value);
      case "lt":
        return Number(v) < Number(f.value);
      case "lte":
        return Number(v) <= Number(f.value);
    }
  });
}

/** Evaluate a flag locally → the variant key. Mirrors the server evaluator's order exactly. */
export function evaluateLocal(flag: FlagPayload, distinctId: string, props: Record<string, unknown>): string {
  const control = flag.variants[0]?.key ?? "control";
  if (!flag.enabled) return control;
  if (flag.targeting.length > 0 && !matches(props, flag.targeting)) return control;
  if (bucket(flag.key, distinctId, "rollout") >= flag.rolloutPercentage / 100) return control;
  const total = flag.variants.reduce((s, v) => s + v.weight, 0);
  if (total <= 0) return control;
  const draw = bucket(flag.key, distinctId, "variant") * total;
  let acc = 0;
  for (const v of flag.variants) {
    acc += v.weight;
    if (draw < acc) return v.key;
  }
  return flag.variants[flag.variants.length - 1].key;
}
