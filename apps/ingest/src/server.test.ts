import { describe, it, expect, afterAll } from "vitest";
import { buildIngestServer } from "./server";

// Boots the ingest server in-process. /health and validation touch no DB, so this runs DB-free (the insert
// path is verified via typecheck + build; a real Postgres runs only in local/lab load tests).
const app = buildIngestServer();
afterAll(async () => {
  await app.close();
});

describe("ingest server (S01)", () => {
  it("GET /health returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("rejects an event with no name (400) before touching the DB", async () => {
    const res = await app.inject({ method: "POST", url: "/e", payload: { distinctId: "u1" } });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an event with no distinctId (400)", async () => {
    const res = await app.inject({ method: "POST", url: "/e", payload: { name: "$pageview" } });
    expect(res.statusCode).toBe(400);
  });
});
