/**
 * Demo data generator (S05) — deterministic, funnel-SHAPED traffic over ~30 days, so the later analytics
 * sprints have real signal to work with: funnels (S08) need a genuine drop-off staircase, retention (S09) needs
 * people who come back on some days and not others. Unlike the raw loadgen (uniform random events), this models
 * PERSONAS with JOURNEYS: each user pages in, some fraction start signup, fewer finish, fewer buy, and active
 * users sprinkle feature_used across return visits. Seeded, so the whole demo dataset reproduces exactly.
 */
import type { EventInput } from "@pulse/shared";
import { mulberry32 } from "./generate";

export interface DemoConfig {
  users: number;
  days: number;
  seed?: number;
  /** End of the window (epoch ms); events land in [end - days, end]. Pin for reproducible datasets. */
  endMs?: number;
}

const BROWSERS = ["Chrome", "Safari", "Firefox", "Edge"];
const IPS = ["8.8.8.8", "31.13.1.1", "103.1.2.3", "77.5.6.7", "200.1.2.3"]; // varied geo (see consumer enrich)
const PLANS = ["free", "pro", "enterprise"];
const DAY_MS = 24 * 60 * 60 * 1000;

/** The funnel: each step's conditional probability given the previous one fired. Produces a real staircase. */
const FUNNEL: Array<{ name: string; p: number }> = [
  { name: "$pageview", p: 1.0 },
  { name: "signup_started", p: 0.4 },
  { name: "signup_completed", p: 0.6 },
  { name: "purchase", p: 0.3 },
];

/** Generate a full demo dataset. Deterministic given the seed + endMs. */
export function generateDemoData(config: DemoConfig): EventInput[] {
  const rng = mulberry32(config.seed ?? 42);
  const end = config.endMs ?? Date.now();
  const start = end - config.days * DAY_MS;
  const out: EventInput[] = [];
  let uuidSeq = 0;
  const mkUuid = (): string => `demo-${config.seed ?? 42}-${uuidSeq++}`;

  for (let u = 0; u < config.users; u++) {
    const distinctId = `person_${u}`;
    const persona = {
      $browser: BROWSERS[Math.floor(rng() * BROWSERS.length)],
      $ip: IPS[Math.floor(rng() * IPS.length)],
      plan: PLANS[Math.floor(rng() * PLANS.length)],
    };
    // Each person is active on a random subset of days (drives retention signal).
    const activeDays = 1 + Math.floor(rng() * config.days);
    for (let d = 0; d < activeDays; d++) {
      const dayOffset = Math.floor(rng() * config.days);
      const ts = start + dayOffset * DAY_MS + Math.floor(rng() * DAY_MS);

      // Walk the funnel: stop at the first step that doesn't fire.
      for (const step of FUNNEL) {
        if (rng() > step.p) break;
        out.push({ name: step.name, distinctId, props: { ...persona }, ts, uuid: mkUuid() });
      }
      // Active users also emit some feature_used events.
      const features = Math.floor(rng() * 4);
      for (let f = 0; f < features; f++) {
        out.push({
          name: "feature_used",
          distinctId,
          props: { ...persona, feature: `f_${Math.floor(rng() * 8)}` },
          ts: ts + f * 1000,
          uuid: mkUuid(),
        });
      }
    }
  }
  return out;
}
