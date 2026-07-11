import { describe, it, expect } from "vitest";
import { assertCapability, capabilitiesFor, CapabilityError, keyCan } from "./capability";

// The capability matrix — the crisp invariant of S02. A public key (WRITE) may only append; a server-side
// key (SECRET) may read. Credentials that differ in AUDIENCE must differ in CAPABILITY.
describe("key capabilities (S02)", () => {
  it("WRITE keys may append but never read", () => {
    expect(keyCan("WRITE", "append")).toBe(true);
    expect(keyCan("WRITE", "read")).toBe(false);
  });

  it("SECRET keys may both append and read", () => {
    expect(keyCan("SECRET", "append")).toBe(true);
    expect(keyCan("SECRET", "read")).toBe(true);
  });

  it("assertCapability throws CapabilityError for a write key reading", () => {
    expect(() => assertCapability("WRITE", "read")).toThrow(CapabilityError);
    expect(() => assertCapability("WRITE", "append")).not.toThrow();
    expect(() => assertCapability("SECRET", "read")).not.toThrow();
  });

  it("capabilitiesFor exposes the whole row", () => {
    expect(capabilitiesFor("WRITE")).toEqual({ append: true, read: false });
    expect(capabilitiesFor("SECRET")).toEqual({ append: true, read: true });
  });
});
