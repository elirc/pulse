import { describe, it, expect } from "vitest";
import { generateApiKey, hashApiKey, keyPrefix, keyTypeFromPlaintext } from "./keys";

describe("api key primitives (S02)", () => {
  it("mints a write key with the pw_live_ shape and a matching hash/prefix", () => {
    const k = generateApiKey("WRITE");
    expect(k.plaintext.startsWith("pw_live_")).toBe(true);
    expect(k.type).toBe("WRITE");
    expect(k.hash).toBe(hashApiKey(k.plaintext));
    expect(k.prefix).toBe(keyPrefix(k.plaintext));
    expect(k.prefix.length).toBe(12);
  });

  it("mints a secret key with the ps_live_ shape", () => {
    expect(generateApiKey("SECRET").plaintext.startsWith("ps_live_")).toBe(true);
  });

  it("reads the type straight from the prefix", () => {
    expect(keyTypeFromPlaintext("pw_live_abcdef")).toBe("WRITE");
    expect(keyTypeFromPlaintext("ps_live_abcdef")).toBe("SECRET");
    expect(keyTypeFromPlaintext("nope_abcdef")).toBeNull();
  });

  it("generates distinct high-entropy keys (no collisions across a batch)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(generateApiKey("WRITE").plaintext);
    expect(seen.size).toBe(500);
  });

  it("hashing is deterministic — a presented key hashes to its stored value", () => {
    const k = generateApiKey("SECRET");
    expect(hashApiKey(k.plaintext)).toBe(k.hash);
  });
});
