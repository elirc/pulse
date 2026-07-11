import { describe, it, expect } from "vitest";
import { originAllowed } from "./origin";

describe("per-key origin allowlist (S02)", () => {
  it("allows any origin when the allowlist is empty or absent (default off)", () => {
    expect(originAllowed([], "https://evil.example")).toBe(true);
    expect(originAllowed(undefined, "https://evil.example")).toBe(true);
  });

  it("with an allowlist, permits listed browser origins and blocks others", () => {
    const allowed = ["https://app.acme.com"];
    expect(originAllowed(allowed, "https://app.acme.com")).toBe(true);
    expect(originAllowed(allowed, "https://phisher.example")).toBe(false);
  });

  it("does not constrain non-browser requests (no Origin header) — the control is browser-only", () => {
    // A curl/server request has no Origin; the allowlist is abuse reduction for browsers, not security.
    expect(originAllowed(["https://app.acme.com"], null)).toBe(true);
  });
});
