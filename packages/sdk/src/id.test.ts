import { describe, it, expect } from "vitest";
import { uuid, loadOrCreateDistinctId, DISTINCT_ID_KEY } from "./id";
import { memoryStorage } from "./storage";

describe("id (S03)", () => {
  it("mints uuid-shaped ids that are unique", () => {
    const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const a = uuid();
    const b = uuid();
    expect(a).toMatch(re);
    expect(a).not.toBe(b);
  });

  it("loadOrCreateDistinctId persists and reuses the anonymous id", () => {
    const s = memoryStorage();
    const first = loadOrCreateDistinctId(s);
    expect(s.get(DISTINCT_ID_KEY)).toBe(first);
    expect(loadOrCreateDistinctId(s)).toBe(first); // stable across calls (survives reloads)
  });
});
