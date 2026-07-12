import { describe, it, expect } from "vitest";
import { GracefulShutdown, runConsumerLoop } from "./shutdown";

describe("graceful shutdown (S15)", () => {
  it("state transitions running → draining → stopped, idempotently", () => {
    const s = new GracefulShutdown();
    expect(s.current).toBe("running");
    expect(s.shouldPullNewBatch()).toBe(true);
    s.requestDrain();
    expect(s.current).toBe("draining");
    s.requestDrain(); // idempotent
    expect(s.current).toBe("draining");
    expect(s.shouldPullNewBatch()).toBe(false);
  });

  it("finishes the in-flight batch after drain is requested, then stops", async () => {
    const s = new GracefulShutdown();
    let batchN = 0;
    let inFlightCompleted = false;
    const processBatch = async (): Promise<number> => {
      batchN++;
      if (batchN === 3) {
        s.requestDrain(); // drain requested DURING batch 3
        await Promise.resolve();
        inFlightCompleted = true; // batch 3 still runs to completion
        return 5;
      }
      return 10;
    };
    const result = await runConsumerLoop(processBatch, s);
    expect(inFlightCompleted).toBe(true); // the in-flight batch was NOT abandoned
    expect(result.batches).toBe(3); // no new batch pulled after drain
    expect(result.processed).toBe(25); // 10 + 10 + 5
    expect(s.current).toBe("stopped");
  });

  it("a drain requested before the loop starts does no work and stops cleanly", async () => {
    const s = new GracefulShutdown();
    s.requestDrain();
    let called = false;
    const result = await runConsumerLoop(() => {
      called = true;
      return Promise.resolve(0);
    }, s);
    expect(called).toBe(false);
    expect(result.batches).toBe(0);
    expect(s.current).toBe("stopped");
  });
});
