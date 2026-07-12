import { describe, it, expect } from "vitest";
import { buildApiServer, type TrendRunner, type QueryCostEvent } from "./server";
import { ConcurrencyLimiter } from "@pulse/shared";
import type { FlatRow, TrendSpec } from "@pulse/insights";

// A thick sampled result: 500 observed in a 10% sample → estimate ~5,000, comfortably reliable.
const thickSampled: FlatRow[] = [{ bucket: "2026-07-11", label: null, value: 500 }];
// A thin sampled result: 4 observed → below the reliability floor, so the server must un-sample.
const thinSampled: FlatRow[] = [{ bucket: "2026-07-11", label: null, value: 4 }];
// The exact (unsampled) rows the un-sample re-run returns.
const exactRows: FlatRow[] = [{ bucket: "2026-07-11", label: null, value: 37 }];
const chTrend: TrendRunner = () => Promise.resolve(exactRows);

describe("interactive sampling endpoint (S12)", () => {
  it("returns scaled estimates + CIs and an x-sampled header when the sample is thick enough", async () => {
    const chTrendSampled = (_s: TrendSpec, _p: string, _r: number): Promise<FlatRow[]> =>
      Promise.resolve(thickSampled);
    const app = buildApiServer({ chTrend, chTrendSampled, readFromClickhouse: true });
    const res = await app.inject({
      method: "POST",
      url: "/insights/trend",
      payload: { spec: { metric: "total" }, sample: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-sampled"]).toBe("0.1");
    const body = res.json() as { sampled: boolean; rows: { value: number; ci95: number; reliable: boolean }[] };
    expect(body.sampled).toBe(true);
    expect(body.rows[0].value).toBe(5000); // 500 / 0.1
    expect(body.rows[0].ci95).toBeGreaterThan(0);
    expect(body.rows[0].reliable).toBe(true);
    await app.close();
  });

  it("un-samples and runs exact when the sample came back too thin to trust", async () => {
    let sampledCalls = 0;
    let exactCalls = 0;
    const chTrendSampled = (): Promise<FlatRow[]> => {
      sampledCalls++;
      return Promise.resolve(thinSampled);
    };
    const countingExact: TrendRunner = () => {
      exactCalls++;
      return Promise.resolve(exactRows);
    };
    const app = buildApiServer({ chTrend: countingExact, chTrendSampled, readFromClickhouse: true });
    const res = await app.inject({
      method: "POST",
      url: "/insights/trend",
      payload: { spec: { metric: "total" }, sample: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-sampled"]).toBe("unsampled");
    const body = res.json() as { sampled: boolean; rows: { value: number }[] };
    expect(body.sampled).toBe(false);
    expect(body.rows[0].value).toBe(37); // the EXACT value, not a scaled estimate
    expect(sampledCalls).toBe(1);
    expect(exactCalls).toBe(1); // proved it re-ran exact
    await app.close();
  });

  it("ignores sampling when not requested — returns the plain row array (back-compat)", async () => {
    const app = buildApiServer({ chTrend, readFromClickhouse: true });
    const res = await app.inject({ method: "POST", url: "/insights/trend", payload: { spec: { metric: "total" } } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(exactRows);
    expect(res.headers["x-sampled"]).toBeUndefined();
    await app.close();
  });
});

describe("query cost guards (S12)", () => {
  it("returns 429 + Retry-After when a project is over its concurrency cap, and logs the rejection", async () => {
    let release!: () => void;
    let entered!: () => void;
    const enteredP = new Promise<void>((r) => (entered = r));
    // A slow runner we can hold in flight to occupy the single slot. It signals `entered` once it's running
    // (i.e. the slot is already acquired), making the test deterministic rather than timing-dependent.
    const slow: TrendRunner = () => {
      entered();
      return new Promise<FlatRow[]>((r) => (release = () => r(exactRows)));
    };
    const costs: QueryCostEvent[] = [];
    const app = buildApiServer({
      chTrend: slow,
      readFromClickhouse: true,
      queryLimiter: new ConcurrencyLimiter(1),
      onQueryCost: (e) => costs.push(e),
    });
    const first = app.inject({ method: "POST", url: "/insights/trend", payload: { spec: { metric: "total" }, projectId: "p1" } });
    await enteredP; // the first query now holds the only slot
    // Second concurrent query for the SAME project should be rejected fast.
    const second = await app.inject({ method: "POST", url: "/insights/trend", payload: { spec: { metric: "total" }, projectId: "p1" } });
    expect(second.statusCode).toBe(429);
    expect(second.headers["retry-after"]).toBe("1");
    expect(second.json()).toMatchObject({ error: "too_many_concurrent_queries", limit: 1 });
    release();
    await first;
    expect(costs.some((c) => c.rejected)).toBe(true);
    expect(costs.some((c) => !c.rejected && c.route === "trend")).toBe(true);
    await app.close();
  });

  it("logs a cost event with a duration for a successful query", async () => {
    const costs: QueryCostEvent[] = [];
    const app = buildApiServer({ chTrend, readFromClickhouse: true, onQueryCost: (e) => costs.push(e) });
    await app.inject({ method: "POST", url: "/insights/trend", payload: { spec: { metric: "total" }, projectId: "p9" } });
    expect(costs).toHaveLength(1);
    expect(costs[0]).toMatchObject({ projectId: "p9", route: "trend", sampled: false });
    expect(costs[0].durationMs).toBeGreaterThanOrEqual(0);
    await app.close();
  });
});
