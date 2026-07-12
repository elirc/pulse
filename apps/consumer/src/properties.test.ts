import { describe, it, expect } from "vitest";
import { IdentityResolver } from "./identity";
import { InMemoryPersonStore } from "./personstore";

const P = "proj1";

describe("person properties $set / $set_once (S06)", () => {
  it("$set is last-write-wins; $set_once is first-touch", async () => {
    const store = new InMemoryPersonStore();
    const r = new IdentityResolver(store);
    const person = await r.resolve(P, "u1");

    await r.setProperties(person, { plan: "free" }, { initial_utm: "google" });
    await r.setProperties(person, { plan: "pro" }, { initial_utm: "facebook" }); // $set overwrites; $set_once sticks

    expect(store.persons.get(person)?.properties).toEqual({ plan: "pro", initial_utm: "google" });
  });

  it("re-applying the same $set is idempotent (safe under redelivery)", async () => {
    const store = new InMemoryPersonStore();
    const r = new IdentityResolver(store);
    const person = await r.resolve(P, "u1");
    await r.setProperties(person, { plan: "pro" }, {});
    await r.setProperties(person, { plan: "pro" }, {});
    expect(store.persons.get(person)?.properties).toEqual({ plan: "pro" });
  });
});
