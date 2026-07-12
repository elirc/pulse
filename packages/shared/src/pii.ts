/**
 * PII scrubbing at ingest (S13). The cheapest compliance is data you never store: what never lands can never
 * leak, never needs deleting, never shows up in a breach. So we scrub *before* the event is enqueued, by a rule
 * per property class:
 *   • DENY  — drop the property entirely (raw email, password, SSN — things we never want).
 *   • HASH  — replace the value with a stable hash (pseudonymize: still joinable/countable, no longer readable).
 * Pure and hash-injectable so CI tests every branch; ingest supplies a sha256 hasher.
 */
export interface ScrubRules {
  /** Property names dropped outright. */
  deny: string[];
  /** Property names whose values are replaced by a stable hash (pseudonymized, not removed). */
  hash: string[];
}

export interface ScrubResult {
  props: Record<string, unknown>;
  dropped: string[];
  hashed: string[];
}

/** A sensible default denylist/hashlist. Deny obvious secrets/PII; pseudonymize identifiers we still want to count. */
export const DEFAULT_SCRUB_RULES: ScrubRules = {
  deny: ["password", "ssn", "credit_card", "$ip_raw", "authorization"],
  hash: ["email", "phone", "ip"],
};

/**
 * Apply scrub rules to a property bag. Denied keys are removed; hashed keys have their value replaced by
 * `hashFn(String(value))`. Matching is case-insensitive on the property name. Returns the scrubbed bag plus what
 * was dropped/hashed, so ingest can emit a redaction audit.
 */
export function scrubProps(
  props: Record<string, unknown>,
  hashFn: (input: string) => string,
  rules: ScrubRules = DEFAULT_SCRUB_RULES,
): ScrubResult {
  const deny = new Set(rules.deny.map((k) => k.toLowerCase()));
  const hash = new Set(rules.hash.map((k) => k.toLowerCase()));
  const out: Record<string, unknown> = {};
  const dropped: string[] = [];
  const hashed: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    const lk = key.toLowerCase();
    if (deny.has(lk)) {
      dropped.push(key);
      continue;
    }
    if (hash.has(lk) && value != null) {
      out[key] = hashFn(String(value));
      hashed.push(key);
      continue;
    }
    out[key] = value;
  }
  return { props: out, dropped, hashed };
}

/** Strip a write-key query param (`?k=…`) from a URL for safe logging (S13). The S03 beacon path puts the key
 *  in the URL; it must never reach an access log verbatim. */
export function redactKeyInUrl(url: string): string {
  return url.replace(/([?&]k=)[^&]*/gi, "$1[REDACTED]");
}
