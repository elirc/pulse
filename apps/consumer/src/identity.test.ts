import { describe, it, expect } from "vitest";
import { IdentityResolver } from "./identity";
import { InMemoryPersonStore } from "./personstore";

const P = "proj1";

describe("identity resolution (S06)", () => {
  it("create-on-first-sight: the same distinctId resolves to a stable person", async () => {
    const r = new IdentityResolver(new InMemoryPersonStore());
    const first = await r.resolve(P, "anon-1");
    expect(await r.resolve(P, "anon-1")).toBe(first);
    expect(await r.resolve(P, "anon-2")).not.toBe(first);
  });

  it("identify merges the anon person into the user person; both ids now resolve to one", async () => {
    const store = new InMemoryPersonStore();
    const r = new IdentityResolver(store, { ttlMs: 0 }); // ttl 0 so resolve always re-reads the store
    const anonPerson = await r.resolve(P, "anon-1"); // person_1 (older)
    const userPerson = await r.resolve(P, "u123"); // person_2
    expect(anonPerson).not.toBe(userPerson);

    const winner = await r.identify(P, "anon-1", "u123");
    expect(winner).toBe(anonPerson); // oldest wins (anon seen first)
    expect(await r.resolve(P, "anon-1")).toBe(winner);
    expect(await r.resolve(P, "u123")).toBe(winner); // the user id now points at the surviving person
    expect(store.persons.has(userPerson)).toBe(false); // loser deleted
  });

  it("re-identifying the same pair is a no-op (already merged)", async () => {
    const r = new IdentityResolver(new InMemoryPersonStore(), { ttlMs: 0 });
    await r.resolve(P, "anon-1");
    await r.resolve(P, "u123");
    const w1 = await r.identify(P, "anon-1", "u123");
    const w2 = await r.identify(P, "anon-1", "u123");
    expect(w2).toBe(w1);
  });
});
