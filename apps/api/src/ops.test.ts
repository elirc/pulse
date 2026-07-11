import { describe, it, expect, afterAll } from "vitest";
import { buildApiServer, type IngestOps } from "./server";

const fakeOps: IngestOps = {
  streamDepth: () => Promise.resolve(1234),
  consumerPending: () => Promise.resolve(56),
  dlqDepth: () => Promise.resolve(2),
};

const app = buildApiServer({ ingestOps: fakeOps });
afterAll(async () => {
  await app.close();
});

describe("ingestion health endpoint (S04)", () => {
  it("reports stream depth, consumer pending, and DLQ count", async () => {
    const res = await app.inject({ method: "GET", url: "/ops/ingest" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ streamDepth: 1234, consumerPending: 56, dlqDepth: 2 });
  });

  it("returns 503 when metrics are not wired", async () => {
    const bare = buildApiServer();
    const res = await bare.inject({ method: "GET", url: "/ops/ingest" });
    expect(res.statusCode).toBe(503);
    await bare.close();
  });
});
