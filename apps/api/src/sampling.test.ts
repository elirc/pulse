import { describe, it, expect } from "vitest";
import { buildApiServer, type TrendRunner } from "./server";
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
