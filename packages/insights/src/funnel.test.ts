import { describe, it, expect } from "vitest";
import { computeFunnel } from "./funnel";
import { computeFunnelNaive } from "./funnel-naive";
import { compileFunnelClickhouse } from "./funnel-sql";
import { FunnelSpecSchema } from "./funnel-spec";
import type { EventLike } from "./compute";

const now = (): Date => new Date("2026-07-20T00:00:00Z");
const D = (iso: string): Date => new Date(iso);
const e = (name: string, person: string, iso: string): EventLike => ({ name, distinctId: person, personId: person, props: {}, ts: D(iso) });

const SPEC = FunnelSpecSchema.parse({
  steps: [{ event: "$pageview" }, { event: "signup_started" }, { event: "purchase" }],
  windowDays: 7,
  days: 30,
});

const EVENTS: EventLike[] = [
  e("$pageview", "alice", "2026-07-15T10:00:00Z"),
  e("$pageview", "alice", "2026-07-15T10:05:00Z"),
  e("signup_started", "alice", "2026-07-15T11:00:00Z"),
  e("purchase", "alice", "2026-07-16T09:00:00Z"),
  e("$pageview", "bob", "2026-07-15T10:00:00Z"),
  e("signup_started", "bob", "2026-07-15T12:00:00Z"),
  e("$pageview", "carol", "2026-07-15T10:00:00Z"),
  e("signup_started", "erin", "2026-07-15T10:00:00Z"), // out of order — step 2 before step 1
  e("$pageview", "erin", "2026-07-15T11:00:00Z"),
];

describe("[S] computeFunnel single-pass (S08)", () => {
  it("matches the naive oracle exactly (correct-then-fast)", () => {
    const fast = computeFunnel(EVENTS, SPEC, now);
    const oracle = computeFunnelNaive(EVENTS, SPEC, now);
    expect(fast.steps.map((s) => s.count)).toEqual(oracle.steps.map((s) => s.count));
    expect(fast.medianTimeToConvertMs).toBe(oracle.medianTimeToConvertMs);
  });

  it("produces the expected step counts [4, 2, 1] (alice/bob/carol/erin enter; erin's signup was out of order)", () => {
    expect(computeFunnel(EVENTS, SPEC, now).steps.map((s) => s.count)).toEqual([4, 2, 1]);
  });
});

describe("compileFunnelClickhouse (S08)", () => {
  it("emits a windowFunnel query with countIf per level and bound params", () => {
    const { text, params } = compileFunnelClickhouse(SPEC, "proj1");
    expect(text).toContain("windowFunnel(604800)(ts,"); // 7 days in seconds
    expect(text).toContain("countIf(level >= 1) AS step1");
    expect(text).toContain("countIf(level >= 3) AS step3");
    expect(Object.values(params)).toContain("$pageview");
    expect(Object.values(params)).toContain("proj1");
  });

  it("SECURITY: a malicious step event lands in params, not the SQL text", () => {
    const evil = "'; DROP TABLE events; --";
    const { text, params } = compileFunnelClickhouse(
      FunnelSpecSchema.parse({ steps: [{ event: evil }, { event: "x" }] }),
      "p1",
    );
    expect(text).not.toContain("DROP TABLE");
    expect(Object.values(params)).toContain(evil);
  });
});
