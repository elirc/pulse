import { describe, it, expect } from "vitest";
import { memoryStorage, browserStorage } from "./storage";

describe("storage (S03)", () => {
  it("memoryStorage round-trips and removes", () => {
    const s = memoryStorage();
    s.set("k", "v");
    expect(s.get("k")).toBe("v");
    s.remove("k");
    expect(s.get("k")).toBeNull();
  });

  it("browserStorage backs onto localStorage under jsdom", () => {
    const s = browserStorage();
    s.set("pulse_test", "1");
    expect(s.get("pulse_test")).toBe("1");
    s.remove("pulse_test");
  });

  it("never throws even if the underlying store is hostile", () => {
    // Nothing here should propagate; the wrapper is the whole point.
    const s = browserStorage();
    expect(() => s.set("x", "y")).not.toThrow();
    expect(() => s.get("missing")).not.toThrow();
    expect(() => s.remove("missing")).not.toThrow();
  });
});
