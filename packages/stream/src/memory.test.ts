import { describe, it, expect } from "vitest";
import { InMemoryEventStream } from "./memory";

const G = "consumers";

describe("InMemoryEventStream consumer-group semantics (S04)", () => {
  it("delivers new entries once and moves them to the pending list", async () => {
    const s = new InMemoryEventStream<number>();
    await s.ensureGroup(G);
    await s.add(1);
    await s.add(2);
    const first = await s.readNew(G, 10);
    expect(first.map((e) => e.data)).toEqual([1, 2]);
    expect(await s.pending(G)).toBe(2);
    const again = await s.readNew(G, 10); // no NEW entries — they're delivered
    expect(again).toEqual([]);
  });

  it("ack removes entries from the pending list", async () => {
    const s = new InMemoryEventStream<number>();
    await s.ensureGroup(G);
    await s.add(1);
    const [entry] = await s.readNew(G, 10);
    await s.ack(G, [entry.id]);
    expect(await s.pending(G)).toBe(0);
  });

  it("redelivers un-acked entries via readPending — where duplicates are born", async () => {
    const s = new InMemoryEventStream<number>();
    await s.ensureGroup(G);
    await s.add(1);
    await s.add(2);
    await s.readNew(G, 10); // delivered, NOT acked (simulate a crash before XACK)
    const redelivered = await s.readPending(G, 10);
    expect(redelivered.map((e) => e.data)).toEqual([1, 2]); // the same entries come back
  });

  it("depth reflects the unprocessed backlog", async () => {
    const s = new InMemoryEventStream<number>();
    await s.ensureGroup(G);
    await s.add(1);
    await s.add(2);
    await s.add(3);
    expect(await s.depth()).toBe(3);
    const batch = await s.readNew(G, 2);
    await s.ack(G, [batch[0].id, batch[1].id]);
    expect(await s.depth()).toBe(1); // one undelivered remains
  });
});
