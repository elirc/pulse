import { describe, it, expect, afterAll } from "vitest";
import { buildApiServer } from "./server";
import { ResultCache, InMemoryCacheStore } from "@pulse/shared";

const app = buildApiServer();
afterAll(async () => {
  await app.close();
});

describe("public route cannot execute arbitrary defs (S10)", () => {
  it("the public dashboard + tile routes are GET-only — there is no way to POST a query spec", async () => {
    // A POST (which could carry a request-supplied AST) has no handler on the public path → 404.
    const postDash = await app.inject({ method: "POST", url: "/public/sometoken", payload: { spec: { metric: "total" } } });
    const postTile = await app.inject({ method: "POST", url: "/public/sometoken/tiles/i1", payload: { spec: { metric: "total" } } });
    expect(postDash.statusCode).toBe(404);
    expect(postTile.statusCode).toBe(404);
  });
});

// The cache behavior (hit/miss/TTL/single-flight) is unit-tested in @pulse/shared; this re-pins the stampede
// property in the API's own suite, since it's the reason the dashboard survives 9am Monday.
describe("result cache single-flight (S10)", () => {
  it("coalesces concurrent misses onto one compute", async () => {
    const cache = new ResultCache(new InMemoryCacheStore());
    let computes = 0;
    const compute = async (): Promise<number> => {
      computes++;
      await new Promise((r) => setTimeout(r, 3));
      return 1;
    };
    await Promise.all(Array.from({ length: 15 }, () => cache.getOrCompute("k", compute)));
    expect(computes).toBe(1);
  });
});
