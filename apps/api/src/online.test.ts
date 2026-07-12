import { describe, it, expect } from "vitest";
import { OnlineWindow, InMemorySortedSetStore } from "./online";

describe("online-now sliding window (S11)", () => {
  it("counts distinct visitors within the window and evicts the stale", async () => {
    let clock = 1_000_000;
    const win = new OnlineWindow(new InMemorySortedSetStore(), { windowMs: 5 * 60_000, now: () => clock });

    await win.seen("p1", "alice", clock);
    await win.seen("p1", "bob", clock);
    await win.seen("p1", "alice", clock); // same person again — still one
    expect(await win.count("p1")).toBe(2);

    clock += 3 * 60_000; // 3 min later, carol shows up
    await win.seen("p1", "carol", clock);
    expect(await win.count("p1")).toBe(3); // alice, bob, carol all within 5 min

    clock += 3 * 60_000; // now alice & bob are >5 min stale, carol is 3 min old
    expect(await win.count("p1")).toBe(1); // only carol remains online
  });

  it("is per project", async () => {
    const win = new OnlineWindow(new InMemorySortedSetStore(), { now: () => 1000 });
    await win.seen("p1", "u1", 1000);
    await win.seen("p2", "u1", 1000);
    expect(await win.count("p1")).toBe(1);
    expect(await win.count("p2")).toBe(1);
  });
});
