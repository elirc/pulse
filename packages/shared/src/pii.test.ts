import { describe, it, expect } from "vitest";
import { scrubProps, redactKeyInUrl, DEFAULT_SCRUB_RULES } from "./pii";

const upper = (s: string): string => `H(${s})`;

describe("scrubProps — deny + hash at ingest (S13)", () => {
  it("drops denied properties entirely", () => {
    const r = scrubProps({ password: "hunter2", name: "click" }, upper, { deny: ["password"], hash: [] });
    expect(r.props).toEqual({ name: "click" });
    expect(r.dropped).toEqual(["password"]);
  });

  it("hashes hash-rule properties (pseudonymize, not remove)", () => {
    const r = scrubProps({ email: "a@b.com", plan: "pro" }, upper, { deny: [], hash: ["email"] });
    expect(r.props).toEqual({ email: "H(a@b.com)", plan: "pro" });
    expect(r.hashed).toEqual(["email"]);
  });

  it("matches property names case-insensitively", () => {
    const r = scrubProps({ Email: "a@b.com", PASSWORD: "x" }, upper, { deny: ["password"], hash: ["email"] });
    expect(r.props).toEqual({ Email: "H(a@b.com)" });
    expect(r.dropped).toEqual(["PASSWORD"]);
    expect(r.hashed).toEqual(["Email"]);
  });

  it("leaves non-matching properties untouched and preserves null/undefined on hash keys", () => {
    const r = scrubProps({ ip: null, ok: 1 }, upper, { deny: [], hash: ["ip"] });
    expect(r.props).toEqual({ ip: null, ok: 1 }); // null isn't hashed (nothing to pseudonymize)
    expect(r.hashed).toEqual([]);
  });

  it("the default rules deny secrets and hash contact identifiers", () => {
    const r = scrubProps({ password: "x", email: "a@b.com", ssn: "1", country: "US" }, upper);
    expect(r.props).toEqual({ email: "H(a@b.com)", country: "US" });
    expect(r.dropped.sort()).toEqual(["password", "ssn"]);
    void DEFAULT_SCRUB_RULES;
  });
});

describe("redactKeyInUrl — keep the write key out of logs (S13)", () => {
  it("redacts a ?k= write key", () => {
    expect(redactKeyInUrl("/e?k=pw_live_secret")).toBe("/e?k=[REDACTED]");
  });
  it("redacts &k= mid-query and leaves other params", () => {
    expect(redactKeyInUrl("/e?foo=1&k=pw_live_secret&bar=2")).toBe("/e?foo=1&k=[REDACTED]&bar=2");
  });
  it("is a no-op when there is no key param", () => {
    expect(redactKeyInUrl("/e?foo=1")).toBe("/e?foo=1");
  });
});
