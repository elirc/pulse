import { describe, it, expect, afterAll } from "vitest";
import { buildApiServer } from "./server";

// Boots the app API in-process; /health touches no DB so this runs DB-free (the daily-counts SQL is verified
// via typecheck + build).
const app = buildApiServer();
afterAll(async () => {
  await app.close();
});

describe("app api (S01)", () => {
  it("GET /health returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("key management auth (S02)", () => {
  it("rejects key issuance without a session (401) before any DB work", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/projects/p1/keys",
      payload: { type: "WRITE" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects key issuance with a garbage bearer token (401)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/projects/p1/keys",
      headers: { authorization: "Bearer not-a-real-token" },
      payload: { type: "WRITE" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("requires a session to list keys (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/projects/p1/keys" });
    expect(res.statusCode).toBe(401);
  });
});
