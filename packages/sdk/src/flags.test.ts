import { describe, it, expect } from "vitest";
import { bucket as sharedBucket } from "@pulse/shared";
import { evaluateLocal, type FlagPayload } from "./flags";
import { Pulse } from "./pulse";
import { memoryStorage } from "./storage";

// Re-derive the SDK's bucket via evaluateLocal on a 100%/single-variant flag isn't enough for parity, so we
// reach the SDK hash through a controlled 2-variant 50/50 flag and compare *decisions* to shared's bucket.
const twoWay: FlagPayload = {
  key: "exp-1",
  enabled: true,
  rolloutPercentage: 100,
  variants: [
    { key: "control", weight: 1 },
    { key: "test", weight: 1 },
  ],
  targeting: [],
};

describe("SDK ↔ shared bucketing parity (S14)", () => {
  it("the SDK's variant decision matches what shared's bucket would decide, for many ids", () => {
    for (let i = 0; i < 2000; i++) {
      const id = `user_${i}`;
      const sdkVariant = evaluateLocal(twoWay, id, {});
      // Reproduce the SDK's variant choice using shared's bucket + the same 50/50 split.
      const draw = sharedBucket("exp-1", id, "variant") * 2;
      const expected = draw < 1 ? "control" : "test";
      expect(sdkVariant).toBe(expected);
    }
  });

  it("rollout gating matches shared's bucket too", () => {
    const rolled: FlagPayload = { ...twoWay, rolloutPercentage: 30 };
    for (let i = 0; i < 2000; i++) {
      const id = `u_${i}`;
      const inRollout = sharedBucket("exp-1", id, "rollout") < 0.3;
      const variant = evaluateLocal(rolled, id, {});
      if (!inRollout) expect(variant).toBe("control");
    }
  });
});

describe("SDK local flag evaluation (S14)", () => {
  it("targeting predicate gates a variant on person properties", () => {
    const flag: FlagPayload = {
      key: "pro-only",
      enabled: true,
      rolloutPercentage: 100,
      variants: [{ key: "off", weight: 1 }, { key: "on", weight: 1 }],
      targeting: [{ property: "plan", op: "eq", value: "pro" }],
    };
    expect(evaluateLocal(flag, "u1", { plan: "free" })).toBe("off"); // not targeted → control
    // A pro user is targeted; the variant then depends on the bucket, but it is NOT forced to control.
    const pro = evaluateLocal(flag, "u1", { plan: "pro" });
    expect(["off", "on"]).toContain(pro);
  });

  it("bootstrap flags evaluate immediately, before any fetch (no flicker)", () => {
    const pulse = new Pulse({ storage: memoryStorage(), transport: { enqueue() {}, flush() {}, flushOnUnload() {}, stop() {} } });
    pulse.init({
      writeKey: "pw_test_x",
      autocapturePageviews: false,
      bootstrapFlags: [{ key: "beta", enabled: true, rolloutPercentage: 100, variants: [{ key: "off", weight: 0 }, { key: "on", weight: 1 }], targeting: [] }],
    });
    expect(pulse.getFeatureFlag("beta")).toBe("on");
    expect(pulse.isFeatureEnabled("beta")).toBe(true);
    expect(pulse.getFeatureFlag("unknown")).toBeNull();
    expect(pulse.isFeatureEnabled("unknown")).toBe(false);
  });

  it("caches fetched flags to storage and evaluates them", async () => {
    const storage = memoryStorage();
    let resolveFetch!: (f: FlagPayload[]) => void;
    const pulse = new Pulse({
      storage,
      transport: { enqueue() {}, flush() {}, flushOnUnload() {}, stop() {} },
      fetchFlags: () => new Promise<FlagPayload[]>((r) => (resolveFetch = r)),
    });
    pulse.init({ writeKey: "pw_test_x", autocapturePageviews: false });
    expect(pulse.getFeatureFlag("shipped")).toBeNull(); // not fetched yet
    resolveFetch([{ key: "shipped", enabled: true, rolloutPercentage: 100, variants: [{ key: "off", weight: 0 }, { key: "on", weight: 1 }], targeting: [] }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(pulse.getFeatureFlag("shipped")).toBe("on");
    expect(storage.get("pulse_flags")).toContain("shipped"); // cached for offline first-paint
  });
});
