import { describe, it, expect } from "vitest";
import { TailHub } from "./tail";
import { OnlineWindow, InMemorySortedSetStore } from "./online";
import type { QueuedEvent } from "@pulse/shared";

/**
 * E2E (S11): an SDK pageview flows to a tail subscriber and increments "online now". Wired on in-memory fakes —
 * the tail loop's job (push to hub + mark seen) done inline, proving the real-time surfaces react to one event.
 */
describe("E2E: pageview → tail → online-now (S11)", () => {
  it("a pageview appears in a subscribed tail and bumps the online counter", async () => {
    const hub = new TailHub();
    let clock = 1_000_000;
    const online = new OnlineWindow(new InMemorySortedSetStore(), { windowMs: 5 * 60_000, now: () => clock });
    hub.subscribe("viewer", { projectId: "acme" });

    // The SDK's pageview, as it lands on the stream and the tail loop processes it.
    const pageview: QueuedEvent = { uuid: "pv1", projectId: "acme", distinctId: "visitor-1", name: "$pageview", props: {}, ts: new Date(clock).toISOString(), ingestedAt: new Date(clock).toISOString() };
    hub.push(pageview);
    await online.seen(pageview.projectId, pageview.distinctId, clock);

    // Appears in the tail.
    const frame = hub.drain("viewer");
    expect(frame.events.map((e) => e.name)).toEqual(["$pageview"]);
    // Online-now incremented.
    expect(await online.count("acme")).toBe(1);

    // A second visitor bumps it; the first ages out after the window.
    const pv2: QueuedEvent = { ...pageview, uuid: "pv2", distinctId: "visitor-2" };
    hub.push(pv2);
    await online.seen(pv2.projectId, pv2.distinctId, clock);
    expect(await online.count("acme")).toBe(2);

    clock += 6 * 60_000; // past the window
    expect(await online.count("acme")).toBe(0);
  });
});
