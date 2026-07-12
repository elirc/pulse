import { describe, it, expect } from "vitest";
import { IdentityResolver } from "./identity";
import { InMemoryPersonStore } from "./personstore";

const P = "proj1";

/**
 * Merge idempotency (S06): identify is delivered at-least-once (S04), so the same identify can arrive twice.
 * Because the winner is deterministic (oldest person), replaying it must land in exactly the same end state —
 * same surviving person, same mappings, same properties. If a re-merge could pick a different winner or double-
 * apply, redelivery would corrupt identity. This is the identity-layer version of "idempotent apply".
 */
describe("merge idempotency (S06)", () => {
  it("replaying the same identify twice yields the same end state", async () => {
    const store = new InMemoryPersonStore();
    const r = new IdentityResolver(store, { ttlMs: 0 });

    const anon = await r.resolve(P, "anon-1"); // older
    const user = await r.resolve(P, "u123");
    await r.setProperties(anon, { plan: "free" }, { initial_utm: "google" });
    await r.setProperties(user, { plan: "pro" }, {});

    const winner1 = await r.identify(P, "anon-1", "u123");
    const stateAfterFirst = {
      winner: winner1,
      anonResolves: await r.resolve(P, "anon-1"),
      userResolves: await r.resolve(P, "u123"),
      properties: { ...store.persons.get(winner1)?.properties },
      personCount: store.persons.size,
      loserGone: !store.persons.has(anon === winner1 ? user : anon),
    };

    // Replay the identical identify.
    const winner2 = await r.identify(P, "anon-1", "u123");

    expect(winner2).toBe(winner1);
    expect(await r.resolve(P, "anon-1")).toBe(stateAfterFirst.anonResolves);
    expect(await r.resolve(P, "u123")).toBe(stateAfterFirst.userResolves);
    expect({ ...store.persons.get(winner2)?.properties }).toEqual(stateAfterFirst.properties);
    expect(store.persons.size).toBe(stateAfterFirst.personCount); // no new person, no resurrected loser
    expect(stateAfterFirst.loserGone).toBe(true);
  });
});
