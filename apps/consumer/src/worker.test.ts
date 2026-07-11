import { describe, it, expect } from "vitest";
import { InMemoryEventStream } from "@pulse/stream";
import type { QueuedEvent } from "@pulse/shared";
import { InMemoryEventStore } from "./store";
import { processNewBatch, drain } from "./worker";

const GROUP = "inserters";

function qe(uuid: string, name = "$pageview"): QueuedEvent {
  return {
    uuid,
    projectId: "p1",
    distinctId: "u1",
    name,
    props: {},
    ts: "2026-07-11T00:00:00.000Z",
    ingestedAt: "2026-07-11T00:00:01.000Z",
  };
}

describe("consumer worker — batched insert + ack (S04)", () => {
  it("reads a batch, inserts it, and acks (pending returns to zero)", async () => {
    const stream = new InMemoryEventStream<QueuedEvent>();
    const store = new InMemoryEventStore();
    await stream.ensureGroup(GROUP);
    await stream.add(qe("a"));
    await stream.add(qe("b"));

    const n = await processNewBatch({ stream, store, group: GROUP, batchSize: 100 });
    expect(n).toBe(2);
    expect(store.events.map((e) => e.uuid)).toEqual(["a", "b"]);
    expect(await stream.pending(GROUP)).toBe(0); // acked
  });

  it("drain processes everything and leaves nothing pending", async () => {
    const stream = new InMemoryEventStream<QueuedEvent>();
    const store = new InMemoryEventStore();
    for (let i = 0; i < 5; i++) await stream.add(qe(`e${i}`));

    const total = await drain({ stream, store, group: GROUP, batchSize: 2 });
    expect(total).toBe(5);
    expect(store.events).toHaveLength(5);
    expect(await stream.pending(GROUP)).toBe(0);
  });
});
