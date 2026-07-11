/**
 * API key primitives (S02) — the machine-auth core, the real teaching material of this sprint.
 *
 * Two key TYPES, distinguished by their audience:
 *   • WRITE  (pw_live_…) — shipped in public page source to strangers. Treat every one as an attacker's key.
 *   • SECRET (ps_live_…) — lives only on a server. Never in a browser, never in a repo.
 *
 * Storage is Stripe-shaped: we keep a sha256 HASH (keys are 140+ bits of entropy, so a fast hash is correct —
 * no bcrypt; there's nothing to brute-force) plus an identifiable PREFIX so support can say "your key ending
 * pw_live_ab12 was last used Tuesday" without ever holding the secret. The plaintext is returned ONCE at
 * issuance and never stored — if you can show a key twice, you stored it wrong.
 *
 * This module deliberately does NOT decide what a key may DO. Capability enforcement is a separate concern
 * (see capability.ts), added as the fix to the privilege-confusion arc in this same PR.
 */
import { createHash, randomBytes } from "node:crypto";

export type KeyType = "WRITE" | "SECRET";

const TYPE_LETTER: Record<KeyType, string> = { WRITE: "w", SECRET: "s" };
const PREFIX_LEN = 12; // "pw_live_ab12" — type + env + 4 chars: identifiable, not reconstructable

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** A cryptographically random base62 string of length `n`. Rejection-free modulo bias is avoided by pulling a
 *  fresh byte per char and masking to the alphabet via rejection of the high, out-of-range values. */
function randomBase62(n: number, rng: (bytes: number) => Buffer = randomBytes): string {
  let out = "";
  while (out.length < n) {
    for (const byte of rng(n)) {
      if (out.length >= n) break;
      if (byte < 248) out += ALPHABET[byte % 62]; // 248 = 4*62; drop 248-255 to keep the draw uniform
    }
  }
  return out;
}

export interface GeneratedKey {
  /** The full secret, shown to the user exactly once. Never store this. */
  plaintext: string;
  /** sha256(plaintext), hex. This is what the DB holds. */
  hash: string;
  /** The identifiable, non-secret leading slice (stored for support/debug). */
  prefix: string;
  type: KeyType;
}

/** sha256(plaintext) as hex — the lookup key. Deterministic, so a presented key hashes to the same value. */
export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** The identifiable prefix of a plaintext key (first {@link PREFIX_LEN} chars). Safe to log/display. */
export function keyPrefix(plaintext: string): string {
  return plaintext.slice(0, PREFIX_LEN);
}

/** Read the key TYPE straight from the plaintext's prefix. `null` if it isn't a Pulse key shape. */
export function keyTypeFromPlaintext(plaintext: string): KeyType | null {
  if (plaintext.startsWith("pw_")) return "WRITE";
  if (plaintext.startsWith("ps_")) return "SECRET";
  return null;
}

/** Mint a new key of `type`. `env` is "live" by default; `rng` is injectable for deterministic tests. */
export function generateApiKey(
  type: KeyType,
  opts: { env?: string; rng?: (bytes: number) => Buffer } = {},
): GeneratedKey {
  const env = opts.env ?? "live";
  const plaintext = `p${TYPE_LETTER[type]}_${env}_${randomBase62(24, opts.rng)}`;
  return { plaintext, hash: hashApiKey(plaintext), prefix: keyPrefix(plaintext), type };
}
