import { describe, it, expect } from "vitest";
import { InMemoryCacheStore } from "@pulse/shared";
import { executePersonDeletion, InMemoryDeletionLedger, type DeletionPorts } from "./deletion";

/**
 * Deletion completeness (S13) — the test that treats erasure as a DATA-INVENTORY AUDIT. A person's data lives in
 * more places than the obvious one: raw events, Postgres metadata, cohort materializations, AND the tile result
 * cache (S10), which would keep serving a "deleted" person's aggregates until TTL. This seeds a person across
 * every store, deletes them, and asserts EVERY copy is gone — including the cache — while a second person's data
 * is untouched. If a future store is added and not enumerated here, this test is where the gap should surface.
 */

interface Inventory {
  events: Array<{ distinctId: string; name: string }>;
  persons: Set<string>;
  mappings: Array<{ personId: string; distinctId: string }>;
  cohortMembers: Array<{ cohortId: string; personId: string }>;
  cache: InMemoryCacheStore;
}

function seed(): Inventory {
  const cache = new InMemoryCacheStore();
  // A cached tile result exists (S10) — it must not survive a deletion.
  void cache.set("tile:dash1:insight1", JSON.stringify({ value: 42 }), 60_000);
  return {
    events: [
      { distinctId: "alice-web", name: "$pageview" },
      { distinctId: "alice-web", name: "purchase" },
      { distinctId: "alice-mobile", name: "$pageview" },
      { distinctId: "bob-web", name: "$pageview" }, // a DIFFERENT person — must survive
    ],
    persons: new Set(["alice", "bob"]),
    mappings: [
      { personId: "alice", distinctId: "alice-web" },
      { personId: "alice", distinctId: "alice-mobile" },
      { personId: "bob", distinctId: "bob-web" },
    ],
    cohortMembers: [
      { cohortId: "power-users", personId: "alice" },
      { cohortId: "power-users", personId: "bob" },
    ],
    cache,
  };
}

function portsOver(inv: Inventory): DeletionPorts {
  return {
    resolveDistinctIds: (personId) =>
      Promise.resolve(inv.mappings.filter((m) => m.personId === personId).map((m) => m.distinctId)),
    deleteMetadata: (personId) => {
      inv.persons.delete(personId);
      inv.mappings = inv.mappings.filter((m) => m.personId !== personId);
      inv.cohortMembers = inv.cohortMembers.filter((c) => c.personId !== personId);
      return Promise.resolve();
    },
    deleteEvents: (distinctIds) => {
      const before = inv.events.length;
      const set = new Set(distinctIds);
      inv.events = inv.events.filter((e) => !set.has(e.distinctId));
      return Promise.resolve(before - inv.events.length);
    },
    flushCaches: async () => {
      await inv.cache.clear?.();
    },
    countRemaining: (distinctIds) => {
      const set = new Set(distinctIds);
      return Promise.resolve(inv.events.filter((e) => set.has(e.distinctId)).length);
    },
    ledger: new InMemoryDeletionLedger(),
  };
}

describe("deletion completeness — zero rows across every store (S13)", () => {
  it("erases the seeded person from events, metadata, cohorts, AND caches", async () => {
    const inv = seed();
    const ports = portsOver(inv);
    const result = await executePersonDeletion("alice", ports, () => "del_alice");

    expect(result.status).toBe("completed");
    expect(result.rowsDeleted).toBe(3); // alice-web ×2 + alice-mobile ×1

    // Events: none for alice's distinctIds.
    expect(inv.events.some((e) => e.distinctId.startsWith("alice"))).toBe(false);
    // Metadata: person + mappings gone.
    expect(inv.persons.has("alice")).toBe(false);
    expect(inv.mappings.some((m) => m.personId === "alice")).toBe(false);
    // Cohort materialization: membership gone.
    expect(inv.cohortMembers.some((c) => c.personId === "alice")).toBe(false);
    // Cache: flushed — the previously cached tile is no longer served.
    expect(await inv.cache.get("tile:dash1:insight1")).toBeNull();
  });

  it("does not touch a different person's data (deletion is scoped)", async () => {
    const inv = seed();
    await executePersonDeletion("alice", portsOver(inv), () => "del_alice");
    expect(inv.persons.has("bob")).toBe(true);
    expect(inv.events.some((e) => e.distinctId === "bob-web")).toBe(true);
    expect(inv.cohortMembers.some((c) => c.personId === "bob")).toBe(true);
  });

  it("reports FAILED if any event row survives the sweep (verification is the contract)", async () => {
    const inv = seed();
    const ports = portsOver(inv);
    // Simulate an incomplete columnar delete: events remain after deleteEvents.
    ports.deleteEvents = () => Promise.resolve(0);
    const result = await executePersonDeletion("alice", ports, () => "del_alice");
    expect(result.status).toBe("failed");
    expect(result.remaining).toBeGreaterThan(0);
  });
});
