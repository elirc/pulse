import { describe, it, expect } from "vitest";
import { executePersonDeletion, InMemoryDeletionLedger, type DeletionPorts } from "./deletion";

/** A recording set of ports over an in-memory "data inventory" so we can assert every store was swept. */
function makePorts(overrides: Partial<DeletionPorts> = {}): {
  ports: DeletionPorts;
  calls: string[];
  remainingRef: { value: number };
} {
  const calls: string[] = [];
  const remainingRef = { value: 0 };
  const ports: DeletionPorts = {
    resolveDistinctIds: (p) => {
      calls.push(`resolve:${p}`);
      return Promise.resolve(["d1", "d2"]);
    },
    deleteMetadata: (p) => {
      calls.push(`metadata:${p}`);
      return Promise.resolve();
    },
    deleteEvents: (ids) => {
      calls.push(`events:${ids.join(",")}`);
      return Promise.resolve(7);
    },
    flushCaches: (p, ids) => {
      calls.push(`caches:${p}:${ids.join(",")}`);
      return Promise.resolve();
    },
    countRemaining: () => {
      calls.push("verify");
      return Promise.resolve(remainingRef.value);
    },
    ledger: new InMemoryDeletionLedger(),
    ...overrides,
  };
  return { ports, calls, remainingRef };
}

describe("executePersonDeletion — append-only erasure orchestration (S13)", () => {
  it("sweeps every store in order and completes when verification hits zero", async () => {
    const { ports, calls } = makePorts();
    const result = await executePersonDeletion("person-1", ports, () => "del_1");
    expect(result.status).toBe("completed");
    expect(result.rowsDeleted).toBe(7);
    expect(result.remaining).toBe(0);
    // Data before done, caches flushed before verify, verify last.
    expect(calls).toEqual([
      "resolve:person-1",
      "metadata:person-1",
      "events:d1,d2",
      "caches:person-1:d1,d2",
      "verify",
    ]);
  });

  it("marks the request FAILED when rows survive verification (unverified deletion is not deletion)", async () => {
    const { ports, remainingRef } = makePorts();
    remainingRef.value = 3; // 3 rows still present after the sweep
    const result = await executePersonDeletion("person-2", ports, () => "del_2");
    expect(result.status).toBe("failed");
    expect(result.remaining).toBe(3);
  });

  it("records the request in the ledger with its outcome (compliance evidence)", async () => {
    const { ports } = makePorts();
    await executePersonDeletion("person-3", ports, () => "del_3");
    const row = await ports.ledger.get("del_3");
    expect(row).toMatchObject({ id: "del_3", personId: "person-3", status: "completed", distinctIds: ["d1", "d2"] });
    expect(row?.completedAt).toBeDefined();
    expect(await ports.ledger.list()).toHaveLength(1);
  });
});
