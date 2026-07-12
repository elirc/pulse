import { describe, it, expect } from "vitest";
import { backfill, InMemoryBackfillSource, type Cursor } from "./backfill";
import { InMemoryColumnStore, BufferedColumnStore } from "./columnstore";
import type { StorableEvent } from "./store";

function ev(uuid: string, ts: string): StorableEvent {
  return { uuid, projectId: "p1", distinctId: "u1", personId: "person1", name: "$pageview", props: {}, ts, ingestedAt: ts };
}

const HISTORY: StorableEvent[] = Array.from({ length: 25 }, (_, i) =>
  ev(`e${String(i).padStart(2, "0")}`, `2026-07-${String(1 + (i % 20)).padStart(2, "0")}T00:00:00.000Z`),
);

describe("backfill (S07)", () => {
  it("copies all history in chunks", async () => {
    const target = new InMemoryColumnStore();
    const total = await backfill(new InMemoryBackfillSource(HISTORY), target, { chunkSize: 10 });
    expect(total).toBe(25);
    expect(target.rows).toHaveLength(25);
  });

  it("is resumable from a checkpoint cursor", async () => {
    const target = new InMemoryColumnStore();
    let checkpoint: Cursor | null = null;
    // Simulate a crash: capture the cursor after the first chunk only.
    const source = new InMemoryBackfillSource(HISTORY);
    const firstChunk = await source.readChunk(null, 10);
    checkpoint = { ts: firstChunk[9].ts, uuid: firstChunk[9].uuid };
    void (await target.insert(firstChunk));

    // Resume from the checkpoint.
    const rest = await backfill(source, target, { chunkSize: 10, startCursor: checkpoint });
    expect(rest).toBe(15);
    expect(target.rows).toHaveLength(25);
  });

  it("is idempotent: re-running over a columnar store with dedupe absorbs the overlap", async () => {
    const inner = new InMemoryColumnStore();
    const target = new BufferedColumnStore(inner, { maxRows: 1000, dedupeWindow: 10_000 });
    await backfill(new InMemoryBackfillSource(HISTORY), target, { chunkSize: 10 });
    await backfill(new InMemoryBackfillSource(HISTORY), target, { chunkSize: 10 }); // full re-run
    await target.flush();
    expect(inner.rows).toHaveLength(25); // dedupe window absorbed the second pass
  });
});
