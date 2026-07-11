import { describe, it, expect } from "vitest";
import { signSession, verifySession } from "./session";

const SECRET = "test-secret";

describe("sessions (S02)", () => {
  it("round-trips a signed session", () => {
    const token = signSession({ userId: "u1", orgId: "o1", role: "owner" }, SECRET);
    expect(verifySession(token, SECRET)).toMatchObject({ userId: "u1", orgId: "o1", role: "owner" });
  });

  it("rejects a tampered payload (bad signature)", () => {
    const token = signSession({ userId: "u1", orgId: "o1", role: "member" }, SECRET);
    const [, sig] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ userId: "attacker", orgId: "o1", role: "owner", exp: Date.now() + 1e6 })).toString("base64url")}.${sig}`;
    expect(verifySession(forged, SECRET)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signSession({ userId: "u1", orgId: "o1", role: "member" }, SECRET);
    expect(verifySession(token, "other-secret")).toBeNull();
  });

  it("rejects an expired session", () => {
    const token = signSession({ userId: "u1", orgId: "o1", role: "member", exp: 1000 }, SECRET);
    expect(verifySession(token, SECRET, () => 2000)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(verifySession("", SECRET)).toBeNull();
    expect(verifySession("no-dot", SECRET)).toBeNull();
    expect(verifySession(".sig", SECRET)).toBeNull();
  });
});
