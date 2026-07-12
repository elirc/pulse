import { describe, it, expect } from "vitest";
import { InMemoryEventStream } from "@pulse/stream";
import type { QueuedEvent } from "@pulse/shared";
import { InMemoryEventStore } from "./store";
import { InMemoryColumnStore } from "./columnstore";
import { InMemoryDeadLetterQueue } from "./dlq";
import { IdentityResolver } from "./identity";
import { InMemoryPersonStore } from "./personstore";
import { drain } from "./worker";

const GROUP = "inserters";
const qe = (uuid: string): QueuedEvent => ({
  uuid,
  projectId: "p1",
  distinctId: "u1",
  name: "$pageview",
  props: {},
  ts: "2026-07-11T00:00:00.000Z",
  ingestedAt: "2026-07-11T00:00:01.000Z",
});

describe("dual-write (S07)", () => {
  it("writes to both PG (truth) and CH (shadow) when a columnStore is present", async () => {
    const stream = new InMemoryEventStream<QueuedEvent>();
    for (let i = 0; i < 3; i++) await stream.add(qe(`e${i}`));
    const store = new InMemoryEventStore();
    const columnStore = new InMemoryColumnStore();

    await drain({
      stream,
      store,
      columnStore,
      dlq: new InMemoryDeadLetterQueue(),
      resolver: new IdentityResolver(new InMemoryPersonStore()),
      group: GROUP,
      batchSize: 100,
    });

    expect(store.events).toHaveLength(3); // Postgres — truth
    expect(columnStore.rows).toHaveLength(3); // ClickHouse — shadow
    expect(columnStore.rows.map((r) => r.personId).every(Boolean)).toBe(true); // resolved before both writes
  });

  it("a shadow (CH) write failure does not fail the batch — PG stays authoritative", async () => {
    const stream = new InMemoryEventStream<QueuedEvent>();
    await stream.add(qe("e1"));
    const store = new InMemoryEventStore();
    const failing = { insert: () => Promise.reject(new Error("CH down")) };

    const total = await drain({
      stream,
      store,
      columnStore: failing,
      dlq: new InMemoryDeadLetterQueue(),
      resolver: new IdentityResolver(new InMemoryPersonStore()),
      group: GROUP,
      batchSize: 100,
    });

    expect(total).toBe(1);
    expect(store.events).toHaveLength(1); // PG write succeeded despite CH failing
    expect(await stream.pending(GROUP)).toBe(0); // acked — the shadow failure didn't block
  });
});
