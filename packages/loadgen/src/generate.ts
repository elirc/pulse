/**
 * The traffic generator (S01) — Pulse's measuring stick, built BEFORE the thing it measures. 📘 You cannot make
 * "Postgres until it breaks" (the S07 migration) a *witnessed* event without a way to apply controlled load, so
 * the loadgen exists from sprint one. This module is the pure generation core (deterministic given a seed); the
 * runnable that actually fires HTTP at `POST /e` at a target rate is the thin edge in `run.ts`.
 */
import type { EventInput } from "@pulse/shared";

export interface GenConfig {
  /** Pool of distinct users to spread events across (drives person cardinality). */
  users: number;
  /** Event-name catalog with relative weights (a realistic funnel skews toward pageviews). */
  names?: Array<{ name: string; weight: number }>;
  seed?: number;
  /** Base event time (epoch ms). Defaults to `Date.now()` for real load; pin it for reproducible batches. */
  baseTimeMs?: number;
}

const DEFAULT_NAMES = [
  { name: "$pageview", weight: 60 },
  { name: "signup_started", weight: 12 },
  { name: "signup_completed", weight: 6 },
  { name: "purchase", weight: 3 },
  { name: "feature_used", weight: 19 },
];

/** A tiny deterministic PRNG (mulberry32) so a seed reproduces the exact traffic — reproducible load tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick a name by weight from a cumulative distribution. */
function weightedPick(names: Array<{ name: string; weight: number }>, r: number): string {
  const total = names.reduce((s, n) => s + n.weight, 0);
  let x = r * total;
  for (const n of names) {
    x -= n.weight;
    if (x <= 0) return n.name;
  }
  return names[names.length - 1].name;
}

/** Generate a batch of `n` events deterministically from the config. Pure — the same seed yields the same batch. */
export function generateBatch(n: number, config: GenConfig): EventInput[] {
  const rng = mulberry32(config.seed ?? 1);
  const names = config.names ?? DEFAULT_NAMES;
  const base = config.baseTimeMs ?? Date.now();
  const out: EventInput[] = [];
  for (let i = 0; i < n; i++) {
    const userIdx = Math.floor(rng() * config.users);
    out.push({
      name: weightedPick(names, rng()),
      distinctId: `user_${userIdx}`,
      props: { $browser: rng() < 0.5 ? "chrome" : "safari", value: Math.floor(rng() * 100) },
      // Event time is deterministic given the seed + base — reproducible load, real-looking recency.
      ts: base - Math.floor(rng() * 60_000),
    });
  }
  return out;
}
