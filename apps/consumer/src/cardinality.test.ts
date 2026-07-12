import { describe, it, expect } from "vitest";
import { CardinalityTracker } from "./cardinality";
import type { QueuedEvent } from "@pulse/shared";

const ev = (props: Record<string, unknown>): QueuedEvent => ({
  uuid: `u${Math.random()}`,
  projectId: "p1",
  distinctId: "u",
  name: "$pageview",
  props,
  ts: "t",
  ingestedAt: "t",
});

describe("cardinality tracker (S12)", () => {
  it("flags a low-cardinality property as low and a high-cardinality one as high", () => {
    const t = new CardinalityTracker();
    for (let i = 0; i < 20_000; i++) {
      t.track(ev({ plan: i % 3 === 0 ? "pro" : "free", $url: `/p/${i}` })); // plan: 2 distinct; $url: 20k distinct
    }
    expect(t.estimate("plan")).toBeLessThan(10);
    expect(t.estimate("$url")).toBeGreaterThan(10_000);
  });

  it("snapshot reports every tracked property", () => {
    const t = new CardinalityTracker();
    t.track(ev({ plan: "pro", country: "US" }));
    const snap = t.snapshot();
    expect(Object.keys(snap).sort()).toEqual(["country", "plan"]);
  });
});
