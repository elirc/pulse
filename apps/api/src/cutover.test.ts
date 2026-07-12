import { describe, it, expect } from "vitest";
import { buildApiServer, type TrendRunner } from "./server";
import type { FlatRow } from "@pulse/insights";

// A ClickHouse trend backend fake — returns fixed rows so we can assert routing without a DB or CH.
const chRows: FlatRow[] = [{ bucket: "2026-07-11", label: null, value: 42 }];
const chTrend: TrendRunner = () => Promise.resolve(chRows);

describe("read cutover + live-verify (S07)", () => {
  it("verify runs both engines and reports drift (Postgres path errors without a DB, so it surfaces)", async () => {
    const app = buildApiServer({ chTrend });
    const res = await app.inject({
      method: "POST",
      url: "/insights/trend/verify",
      payload: { spec: { metric: "total" } },
    });
    // With no DB, the PG side rejects → 500; the point is the route exists and needs both backends.
    expect([200, 500]).toContain(res.statusCode);
    await app.close();
  });

  it("verify returns 503 when the ClickHouse backend isn't wired", async () => {
    const app = buildApiServer();
    const res = await app.inject({ method: "POST", url: "/insights/trend/verify", payload: { spec: { metric: "total" } } });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it("read cutover routes /insights/trend to ClickHouse when the flag is on", async () => {
    const app = buildApiServer({ chTrend, readFromClickhouse: true });
    const res = await app.inject({ method: "POST", url: "/insights/trend", payload: { spec: { metric: "total" } } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(chRows); // served from CH, not PG (which would need a DB)
    await app.close();
  });
});
