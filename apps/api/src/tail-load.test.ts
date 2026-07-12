import { describe, it, expect } from "vitest";
import { TailHub } from "./tail";
import type { QueuedEvent } from "@pulse/shared";

const ev = (i: number): QueuedEvent => ({ uuid: `e${i}`, projectId: "p1", distinctId: `u${i}`, name: "e", props: {}, ts: "t", ingestedAt: "t" });

/**
 * The slow-client contract (S11): a slow dashboard tab must NOT back-pressure the pipeline or grow memory
 * without bound. Its buffer is capped; overflow drops the oldest and counts the drops. Contrast the ingest path,
 * whose contract is the opposite (never drop). Same system, two correctness definitions — write down which one
 * each surface promises.
 */
describe("SSE tail under load — slow-client backpressure (S11)", () => {
  it("a slow client that never drains stays bounded (no OOM) and counts every drop", () => {
    const MAX = 100;
    const hub = new TailHub(MAX);
    hub.subscribe("slow");
    hub.subscribe("fast");

    const N = 10_000;
    for (let i = 0; i < N; i++) {
      hub.push(ev(i));
      if (i % 50 === 0) hub.drain("fast"); // the fast client keeps up
    }

    const slow = hub.drain("slow");
    expect(slow.events.length).toBe(MAX); // bounded — never grew past the cap
    expect(slow.dropped).toBe(N - MAX); // every dropped frame counted
    expect(slow.events[slow.events.length - 1].uuid).toBe(`e${N - 1}`); // keeps the freshest
  });

  it("the fast client (draining) loses nothing", () => {
    const hub = new TailHub(100);
    hub.subscribe("fast");
    let received = 0;
    for (let i = 0; i < 1000; i++) {
      hub.push(ev(i));
      received += hub.drain("fast").events.length;
    }
    expect(received).toBe(1000);
  });
});
