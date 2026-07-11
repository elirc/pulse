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
