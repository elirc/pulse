import { describe, it, expect, afterEach } from "vitest";
import { Pulse } from "./pulse";
import { memoryStorage } from "./storage";
import type { Transport } from "./transport";
import type { EventEnvelope } from "./types";

class CapturingTransport implements Transport {
  events: EventEnvelope[] = [];
  enqueue(e: EventEnvelope): void {
    this.events.push(e);
  }
  flush(): void {}
  flushOnUnload(): void {}
  stop(): void {}
}

let active: Pulse | null = null;
afterEach(() => {
  active?.shutdown();
  active = null;
});

function makePulse(transport: CapturingTransport): Pulse {
  const p = new Pulse({ transport, storage: memoryStorage() });
  active = p;
  return p;
}

describe("Pulse core (S03)", () => {
  it("capture builds an envelope with a uuid, the distinctId, and an ISO ts", () => {
    const t = new CapturingTransport();
    const p = makePulse(t);
    p.init({ writeKey: "pw_live_x", autocapturePageviews: false });
    p.capture("purchase", { amount: 9 });
    const last = t.events.at(-1)!;
    expect(last).toMatchObject({ name: "purchase", props: { amount: 9 } });
    expect(last.uuid).toMatch(/[0-9a-f-]{36}/);
    expect(last.distinctId).toBe(p.getDistinctId());
    expect(() => new Date(last.ts).toISOString()).not.toThrow();
  });

  it("identify sets the distinctId; reset regenerates an anonymous one", () => {
    const t = new CapturingTransport();
    const p = makePulse(t);
    p.init({ writeKey: "pw_live_x", autocapturePageviews: false });
    p.identify("user-42");
    p.capture("e");
    expect(t.events.at(-1)!.distinctId).toBe("user-42");
    p.reset();
    expect(p.getDistinctId()).not.toBe("user-42");
  });

  it("captures an initial $pageview and one per SPA navigation when autocapture is on", () => {
    const t = new CapturingTransport();
    const p = makePulse(t);
    p.init({ writeKey: "pw_live_x", autocapturePageviews: true });
    const initial = t.events.filter((e) => e.name === "$pageview").length;
    expect(initial).toBe(1);
    history.pushState({}, "", "/next");
    expect(t.events.filter((e) => e.name === "$pageview").length).toBe(2);
  });

  it("capture before init is a no-op, not a crash", () => {
    const p = new Pulse({ transport: new CapturingTransport(), storage: memoryStorage() });
    active = p;
    expect(() => p.capture("early")).not.toThrow();
  });
});
