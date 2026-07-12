import { describe, it, expect } from "vitest";
import { resolveEventTime, MAX_CLOCK_SKEW_MS } from "./index";

const INGEST = new Date("2026-07-11T12:00:00Z");

describe("resolveEventTime — server-authoritative time with skew clamp (S13, flaw #3)", () => {
  it("trusts a client ts within the ±48h window", () => {
    const ts = new Date(INGEST.getTime() - 60_000).toISOString(); // 1 min ago
    const r = resolveEventTime(ts, INGEST);
    expect(r.clamped).toBe(false);
    expect(r.ts.toISOString()).toBe(ts);
  });

  it("clamps a far-future ts (event 'from 2031') to +48h and flags it", () => {
    const r = resolveEventTime("2031-01-01T00:00:00Z", INGEST);
    expect(r.clamped).toBe(true);
    expect(r.ts.getTime()).toBe(INGEST.getTime() + MAX_CLOCK_SKEW_MS);
  });

  it("clamps a far-past ts (event 'from 1970') to -48h and flags it", () => {
    const r = resolveEventTime(0, INGEST); // epoch
    expect(r.clamped).toBe(true);
    expect(r.ts.getTime()).toBe(INGEST.getTime() - MAX_CLOCK_SKEW_MS);
  });

  it("falls back to server time for a missing or invalid ts, unflagged", () => {
    expect(resolveEventTime(undefined, INGEST)).toEqual({ ts: INGEST, clamped: false });
    expect(resolveEventTime("not-a-date", INGEST)).toEqual({ ts: INGEST, clamped: false });
  });

  it("the boundary itself is trusted (exactly ±48h is not clamped)", () => {
    const edge = new Date(INGEST.getTime() + MAX_CLOCK_SKEW_MS).toISOString();
    expect(resolveEventTime(edge, INGEST).clamped).toBe(false);
  });
});
