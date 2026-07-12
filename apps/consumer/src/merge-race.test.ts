import { describe, it, expect } from "vitest";
import { IdentityResolver } from "./identity";
import { InMemoryPersonStore } from "./personstore";

const P = "proj1";

/**
 * The merge race (S06): a user signs in on two devices at the same instant, each with its own anonymous id.
 * Both identifies resolve the user id create-on-first-sight — and because resolution isn't atomic, both can see
 * "no person for u123" and both create one. The user ends up as TWO persons; "how many users do we have?"
 * becomes a lie. This spec asserts the invariant (one user → one person) and FAILS against the unlocked
 * resolver; the advisory-lock fix in the next commit makes it pass.
 */
describe("concurrent identify from two devices (S06)", () => {
  it("one user must remain one person under concurrent identify", async () => {
    const store = new InMemoryPersonStore();
    const resolver = new IdentityResolver(store, { ttlMs: 0 }); // no cache masking; always hit the store

    // Two devices, same user, at the same time.
    await Promise.all([resolver.identify(P, "anonA", "u123"), resolver.identify(P, "anonB", "u123")]);

    const [pa, pb, pu] = await Promise.all([
      resolver.resolve(P, "anonA"),
      resolver.resolve(P, "anonB"),
      resolver.resolve(P, "u123"),
    ]);
    // All three ids should point at exactly one surviving person.
    expect(new Set([pa, pb, pu]).size).toBe(1);
  });
});
