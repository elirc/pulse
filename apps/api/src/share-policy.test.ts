import { describe, it, expect } from "vitest";
import { evaluateShareToken, EnumerationMonitor, SHARE_TOKEN_TTL_MS } from "./share-policy";

const NOW = new Date("2026-07-11T12:00:00Z");

describe("share-token policy (S13, harvests flaw #5)", () => {
  it("a live, unexpired token resolves to its dashboard", () => {
    const v = evaluateShareToken(
      { dashboardId: "d1", revokedAt: null, expiresAt: new Date(NOW.getTime() + 1000) },
      NOW,
    );
    expect(v).toEqual({ valid: true, dashboardId: "d1" });
  });

  it("a revoked token is invalid even if not yet expired", () => {
    const v = evaluateShareToken(
      { dashboardId: "d1", revokedAt: new Date(NOW.getTime() - 1000), expiresAt: new Date(NOW.getTime() + 999999) },
      NOW,
    );
    expect(v).toEqual({ valid: false, reason: "revoked" });
  });

  it("an expired token is invalid (expiry is inclusive at the boundary)", () => {
    expect(evaluateShareToken({ dashboardId: "d1", revokedAt: null, expiresAt: NOW }, NOW)).toEqual({
      valid: false,
      reason: "expired",
    });
    expect(
      evaluateShareToken({ dashboardId: "d1", revokedAt: null, expiresAt: new Date(NOW.getTime() - 1) }, NOW).valid,
    ).toBe(false);
  });

  it("a null expiresAt (legacy token) never expires but can still be revoked", () => {
    expect(evaluateShareToken({ dashboardId: "d1", revokedAt: null, expiresAt: null }, NOW).valid).toBe(true);
    expect(
      evaluateShareToken({ dashboardId: "d1", revokedAt: new Date(0), expiresAt: null }, NOW).valid,
    ).toBe(false);
  });

  it("the default TTL is 90 days", () => {
    expect(SHARE_TOKEN_TTL_MS).toBe(90 * 24 * 60 * 60 * 1000);
  });
});

describe("enumeration monitor (S13)", () => {
  it("flags a source after the miss threshold inside the window", () => {
    const t = 0;
    const mon = new EnumerationMonitor({ threshold: 5, windowMs: 1000, now: () => t });
    for (let i = 0; i < 4; i++) expect(mon.recordMiss("1.2.3.4")).toBe(false);
    expect(mon.recordMiss("1.2.3.4")).toBe(true); // 5th miss → flagged
  });

  it("ages out misses beyond the window (not a permanent tally)", () => {
    let t = 0;
    const mon = new EnumerationMonitor({ threshold: 3, windowMs: 1000, now: () => t });
    mon.recordMiss("scanner");
    mon.recordMiss("scanner");
    t = 2000; // both earlier misses fall outside the 1s window
    expect(mon.missCount("scanner")).toBe(0);
    expect(mon.recordMiss("scanner")).toBe(false); // fresh count of 1
  });

  it("tracks sources independently", () => {
    const t = 0;
    const mon = new EnumerationMonitor({ threshold: 2, windowMs: 1000, now: () => t });
    mon.recordMiss("a");
    expect(mon.missCount("a")).toBe(1);
    expect(mon.missCount("b")).toBe(0);
  });
});
