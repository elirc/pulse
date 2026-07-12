import { describe, it, expect } from "vitest";
import { TailHub } from "./tail";
import type { QueuedEvent } from "@pulse/shared";

const ev = (name: string, distinctId: string): QueuedEvent => ({
  uuid: `${name}-${distinctId}-${Math.random()}`,
  projectId: "p1",
  distinctId,
  name,
  props: {},
  ts: "2026-08-01T00:00:00.000Z",
  ingestedAt: "2026-08-01T00:00:00.000Z",
});

describe("TailHub fan-out (S11)", () => {
  it("fans events to subscribers and drains them", () => {
    const hub = new TailHub();
    hub.subscribe("a");
    hub.push(ev("$pageview", "u1"));
    hub.push(ev("purchase", "u2"));
    const frame = hub.drain("a");
    expect(frame.events).toHaveLength(2);
    expect(hub.drain("a").events).toHaveLength(0); // drained
  });

  it("applies server-side filters (event / distinctId)", () => {
    const hub = new TailHub();
    hub.subscribe("only-purchases", { event: "purchase" });
    hub.subscribe("only-u1", { distinctId: "u1" });
    hub.push(ev("$pageview", "u1"));
    hub.push(ev("purchase", "u2"));
    expect(hub.drain("only-purchases").events.map((e) => e.name)).toEqual(["purchase"]);
    expect(hub.drain("only-u1").events.map((e) => e.distinctId)).toEqual(["u1"]);
  });

  it("drop policy: a slow client's overflow drops the OLDEST and counts drops (freshness > completeness)", () => {
    const hub = new TailHub(3); // tiny buffer
    hub.subscribe("slow");
    for (let i = 0; i < 10; i++) hub.push(ev("e", `u${i}`));
    const frame = hub.drain("slow");
    expect(frame.events).toHaveLength(3); // only the newest 3 survive
    expect(frame.dropped).toBe(7); // 7 older frames dropped and counted
    expect(frame.events.map((e) => e.distinctId)).toEqual(["u7", "u8", "u9"]); // the most recent
  });
});
