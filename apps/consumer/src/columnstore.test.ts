import { describe, it, expect } from "vitest";
import { InMemoryColumnStore, BufferedColumnStore } from "./columnstore";
import type { StorableEvent } from "./store";

const ev = (uuid: string): StorableEvent => ({
  uuid,
  projectId: "p1",
  distinctId: "u1",
  personId: "person1",
  name: "$pageview",
  props: {},
  ts: "2026-07-11T00:00:00.000Z",
  ingestedAt: "2026-07-11T00:00:01.000Z",
});

describe("BufferedColumnStore insert window (S07)", () => {
  it("buffers small inserts and flushes as one big insert at the window size", async () => {
    const inner = new InMemoryColumnStore();
    let inserts = 0;
    const orig = inner.insert.bind(inner);
    inner.insert = (rows) => {
      inserts++;
      return orig(rows);
    };
    const buffered = new BufferedColumnStore(inner, { maxRows: 5 });

    await buffered.insert([ev("a"), ev("b")]);
    await buffered.insert([ev("c"), ev("d")]);
    expect(inserts).toBe(0); // 4 < 5 — still buffering
    expect(buffered.pending()).toBe(4);

    await buffered.insert([ev("e")]); // reaches 5 → one flush
    expect(inserts).toBe(1);
    expect(inner.rows).toHaveLength(5);
    expect(buffered.pending()).toBe(0);
  });

  it("flush() drains a partial buffer (timer/shutdown path)", async () => {
    const inner = new InMemoryColumnStore();
    const buffered = new BufferedColumnStore(inner, { maxRows: 1000 });
    await buffered.insert([ev("a")]);
    await buffered.flush();
    expect(inner.rows).toHaveLength(1);
  });
});

describe("dedupe v2 (S07)", () => {
  it("insert-window drops a redelivered uuid before it reaches the store", async () => {
    const inner = new InMemoryColumnStore();
    const buffered = new BufferedColumnStore(inner, { maxRows: 1000, dedupeWindow: 1000 });
    await buffered.insert([ev("a"), ev("b")]);
    await buffered.insert([ev("a")]); // redelivery of a — caught by the window
    await buffered.flush();
    expect(inner.rows.map((r) => r.uuid)).toEqual(["a", "b"]);
  });

  it("ReplacingMergeTree modeling: deduped() keeps one row per uuid (latest ingestedAt)", () => {
    const inner = new InMemoryColumnStore();
    // Simulate a straggler that slipped past the window (inserted directly): two rows, same uuid.
    void inner.insert([
      { ...ev("x"), ingestedAt: "2026-07-11T00:00:01.000Z" },
      { ...ev("x"), ingestedAt: "2026-07-11T00:00:09.000Z" },
    ]);
    expect(inner.rows).toHaveLength(2); // both physically present until a merge
    const merged = inner.deduped();
    expect(merged).toHaveLength(1);
    expect(merged[0].ingestedAt).toBe("2026-07-11T00:00:09.000Z"); // latest wins
  });
});
