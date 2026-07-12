import { describe, it, expect } from "vitest";
import { ConcurrencyLimiter, ConcurrencyLimitError } from "./concurrency";

describe("per-project concurrency limiter (S12)", () => {
  it("allows up to maxPerKey in flight, rejects the next", () => {
    const lim = new ConcurrencyLimiter(2);
    expect(lim.tryAcquire("p1")).toBe(true);
    expect(lim.tryAcquire("p1")).toBe(true);
    expect(lim.tryAcquire("p1")).toBe(false); // at cap
    expect(lim.inflightFor("p1")).toBe(2);
  });

  it("caps each project independently — a busy tenant doesn't throttle a quiet one", () => {
    const lim = new ConcurrencyLimiter(1);
    expect(lim.tryAcquire("busy")).toBe(true);
    expect(lim.tryAcquire("busy")).toBe(false);
    expect(lim.tryAcquire("quiet")).toBe(true); // unaffected
  });

  it("releasing frees a slot", () => {
    const lim = new ConcurrencyLimiter(1);
    lim.tryAcquire("p1");
    lim.release("p1");
    expect(lim.inflightFor("p1")).toBe(0);
    expect(lim.tryAcquire("p1")).toBe(true);
  });

  it("run() holds a slot for the duration and releases even on throw", async () => {
    const lim = new ConcurrencyLimiter(1);
    await expect(lim.run("p1", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(lim.inflightFor("p1")).toBe(0); // released despite the failure
  });

  it("run() throws ConcurrencyLimitError immediately when over the cap", async () => {
    const lim = new ConcurrencyLimiter(1);
    let release!: () => void;
    const held = lim.run("p1", () => new Promise<void>((r) => (release = r)));
    await expect(lim.run("p1", () => Promise.resolve())).rejects.toBeInstanceOf(ConcurrencyLimitError);
    release();
    await held;
    expect(lim.inflightFor("p1")).toBe(0);
  });
});
