import { describe, it, expect } from "vitest";
import { InMemoryEventStream } from "@pulse/stream";
import type { QueuedEvent } from "@pulse/shared";
import { InMemoryEventStore } from "./store";
import { InMemoryDeadLetterQueue } from "./dlq";
import { IdentityResolver } from "./identity";
import { InMemoryPersonStore } from "./personstore";
import { processNewBatch } from "./worker";
import { replayRecords } from "./replay";

const GROUP = "inserters";

function qe(uuid: string): QueuedEvent {
  return {
    uuid,
    projectId: "p1",
    distinctId: "u1",
    name: "$pageview",
    props: {},
    ts: "2026-07-11T00:00:00.000Z",
    ingestedAt: "2026-07-11T00:00:01.000Z",
  };
}

describe("dead-letter queue (S04)", () => {
  it("routes a poison entry to the DLQ, acks it, and still processes the good ones", async () => {
    const stream = new InMemoryEventStream<QueuedEvent>();
    const store = new InMemoryEventStore();
    const dlq = new InMemoryDeadLetterQueue();
    await stream.ensureGroup(GROUP);
    await stream.add(qe("good-1"));
    // A corrupt entry: missing required fields. Cast to satisfy the typed stream (simulating stream corruption
    // or a rogue producer).
    await stream.add({ uuid: "", name: "" } as unknown as QueuedEvent);
    await stream.add(qe("good-2"));

    const n = await processNewBatch({ stream, store, dlq, resolver: new IdentityResolver(new InMemoryPersonStore()), group: GROUP, batchSize: 100 });
    expect(n).toBe(3); // all three entries handled...
    expect(store.events.map((e) => e.uuid)).toEqual(["good-1", "good-2"]); // ...two stored...
    expect(dlq.records).toHaveLength(1); // ...one dead-lettered with error context
    expect(dlq.records[0].error).toContain("distinctId");
    expect(await stream.pending(GROUP)).toBe(0); // poison did NOT wedge the group
  });

  it("replay re-submits records that are valid after a fix, skipping the rest", async () => {
    const main = new InMemoryEventStream<QueuedEvent>();
    const records = [
      { data: qe("recovered"), error: "was a transient validator bug", failedAt: "t" },
      { data: { nope: true }, error: "still malformed", failedAt: "t" },
    ];
    const result = await replayRecords(records, main);
    expect(result).toEqual({ replayed: 1, skipped: 1 });
    expect(await main.depth()).toBe(1);
  });
});
