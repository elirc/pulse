import { describe, it, expect, vi } from "vitest";
import { Pulse } from "./pulse";
import { memoryStorage } from "./storage";
import type { EventEnvelope } from "./types";
import type { FlagPayload } from "./flags";

function pulseWithCapture(): { pulse: Pulse; events: EventEnvelope[] } {
  const events: EventEnvelope[] = [];
  const pulse = new Pulse({
    storage: memoryStorage(),
    transport: { enqueue: (e) => events.push(e), flush() {}, flushOnUnload() {}, stop() {} },
  });
  return { pulse, events };
}

const beta: FlagPayload = {
  key: "beta",
  enabled: true,
  rolloutPercentage: 100,
  variants: [{ key: "off", weight: 0 }, { key: "on", weight: 1 }],
  targeting: [],
};

describe("SDK flag exposure events (S14)", () => {
  it("emits $flag_evaluated with the variant on first evaluation", () => {
    const { pulse, events } = pulseWithCapture();
    pulse.init({ writeKey: "pw_test_x", autocapturePageviews: false, bootstrapFlags: [beta] });
    pulse.getFeatureFlag("beta");
    const exposure = events.find((e) => e.name === "$flag_evaluated");
    expect(exposure).toBeDefined();
    expect(exposure?.props).toMatchObject({ $flag_key: "beta", $variant: "on" });
  });

  it("dedupes exposure per (flag, variant) for the session — a flag checked 100x emits ONE exposure", () => {
    const { pulse, events } = pulseWithCapture();
    pulse.init({ writeKey: "pw_test_x", autocapturePageviews: false, bootstrapFlags: [beta] });
    for (let i = 0; i < 100; i++) pulse.getFeatureFlag("beta");
    expect(events.filter((e) => e.name === "$flag_evaluated")).toHaveLength(1);
  });

  it("an unknown flag emits no exposure", () => {
    const { pulse, events } = pulseWithCapture();
    pulse.init({ writeKey: "pw_test_x", autocapturePageviews: false, bootstrapFlags: [beta] });
    pulse.getFeatureFlag("does-not-exist");
    expect(events.some((e) => e.name === "$flag_evaluated")).toBe(false);
  });

  it("reset() clears the dedupe set so the new identity is re-exposed", () => {
    const { pulse, events } = pulseWithCapture();
    pulse.init({ writeKey: "pw_test_x", autocapturePageviews: false, bootstrapFlags: [beta] });
    pulse.getFeatureFlag("beta");
    pulse.reset();
    pulse.getFeatureFlag("beta");
    expect(events.filter((e) => e.name === "$flag_evaluated")).toHaveLength(2);
  });

  it("isFeatureEnabled also records exposure (evaluation is evaluation)", () => {
    const { pulse, events } = pulseWithCapture();
    pulse.init({ writeKey: "pw_test_x", autocapturePageviews: false, bootstrapFlags: [beta] });
    pulse.isFeatureEnabled("beta");
    expect(events.filter((e) => e.name === "$flag_evaluated")).toHaveLength(1);
    void vi; // (kept for symmetry with other suites)
  });
});
