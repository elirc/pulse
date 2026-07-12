import { describe, it, expect } from "vitest";
import { InMemoryEventStream } from "@pulse/stream";
import type { QueuedEvent } from "@pulse/shared";
import { InMemoryEventStore } from "./store";
import { InMemoryDeadLetterQueue } from "./dlq";
import { IdentityResolver } from "./identity";
import { InMemoryPersonStore } from "./personstore";
import { enrich } from "./enrich";
import { processPendingBatch } from "./worker";

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

/**
 * At-least-once delivery, demonstrated: a consumer that inserts a batch and then CRASHES before XACK leaves the
 * entries in the pending list. On restart they are redelivered and inserted AGAIN. This spec asserts the
 * property we actually want — effective exactly-once — and so it FAILS until the insert is made idempotent
 * (next commit). The duplicate rows here are not a bug in delivery; they are delivery working as designed, and
 * the fix belongs in the APPLY, not the transport.
 */
describe("crash mid-batch → redelivery (S04)", () => {
  it("stores each event exactly once despite at-least-once redelivery", async () => {
    const stream = new InMemoryEventStream<QueuedEvent>();
    const store = new InMemoryEventStore();
    await stream.ensureGroup(GROUP);
    await stream.add(qe("dup-1"));
    await stream.add(qe("dup-2"));

    // First delivery: read + insert, then CRASH before ack (no XACK).
    const delivered = await stream.readNew(GROUP, 100);
    await store.insertBatch(delivered.map((e) => ({ ...enrich(e.data), personId: "p-x" })));

    // Restart: the un-acked entries are redelivered and processed again.
    await processPendingBatch({ stream, store, dlq: new InMemoryDeadLetterQueue(), resolver: new IdentityResolver(new InMemoryPersonStore()), group: GROUP, batchSize: 100 });

    const uuids = store.events.map((e) => e.uuid);
    expect(uuids.filter((u) => u === "dup-1")).toHaveLength(1);
    expect(uuids.filter((u) => u === "dup-2")).toHaveLength(1);
  });
});
