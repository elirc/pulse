import { describe, it, expect } from "vitest";
import { Sessionizer, InMemorySessionStore, SESSION_DEF_VERSION } from "./session";
import type { QueuedEvent } from "@pulse/shared";

const T = (min: number): number => new Date("2026-08-01T00:00:00Z").getTime() + min * 60_000;
let counter = 0;
const newId = (): string => `s${++counter}`;

describe("session-ization (S11)", () => {
  it("keeps the same session within the gap, starts a new one after it", async () => {
    counter = 0;
    const s = new Sessionizer(new InMemorySessionStore(), { gapMs: 30 * 60_000, newId });
    const a = await s.assign("p1", "u1", T(0));
    const b = await s.assign("p1", "u1", T(20)); // 20 min later — same session
    const c = await s.assign("p1", "u1", T(60)); // 40 min after b — new session
    expect(a).toBe("s1");
    expect(b).toBe("s1");
    expect(c).toBe("s2");
  });

  it("sessions are per distinctId", async () => {
    counter = 0;
    const s = new Sessionizer(new InMemorySessionStore(), { newId });
    const u1 = await s.assign("p1", "u1", T(0));
    const u2 = await s.assign("p1", "u2", T(0));
    expect(u1).not.toBe(u2);
  });

  it("stamps $session_id and the definition version onto the event", async () => {
    counter = 0;
    const s = new Sessionizer(new InMemorySessionStore(), { newId });
    const event: QueuedEvent = { uuid: "e", projectId: "p1", distinctId: "u1", name: "$pageview", props: {}, ts: "2026-08-01T00:00:00Z", ingestedAt: "2026-08-01T00:00:00Z" };
    const stamped = await s.stamp(event);
    expect(stamped.props.$session_id).toBe("s1");
    expect(stamped.props.$session_v).toBe(SESSION_DEF_VERSION);
  });
});
