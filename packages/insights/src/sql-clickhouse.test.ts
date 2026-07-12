import { describe, it, expect } from "vitest";
import { compileTrendClickhouse } from "./sql-clickhouse";
import { TrendSpecSchema } from "./spec";

const spec = (over: Record<string, unknown> = {}): ReturnType<typeof TrendSpecSchema.parse> =>
  TrendSpecSchema.parse(over);

describe("compileTrendClickhouse (S07)", () => {
  it("counts by day over the events table with bound params", () => {
    const { text, params } = compileTrendClickhouse(spec(), "proj1");
    expect(text).toContain("count()");
    expect(text).toContain("toStartOfDay(ts)");
    expect(text).toContain("FROM events");
    expect(text).toContain("projectId = {p1:String}");
    expect(params.p1).toBe("proj1");
  });

  it("unique uses approximate uniq() by default, uniqExact() when asked, over person", () => {
    expect(compileTrendClickhouse(spec({ metric: "unique" }), "p1").text).toContain(
      "uniq(if(personId != '', personId, distinctId))",
    );
    expect(compileTrendClickhouse(spec({ metric: "unique" }), "p1", { exact: true }).text).toContain(
      "uniqExact(if(personId != '', personId, distinctId))",
    );
  });

  it("filters read props via JSONExtractString and bind the key + value", () => {
    const { text, params } = compileTrendClickhouse(
      spec({ filters: [{ property: "plan", op: "eq", value: "pro" }] }),
      "p1",
    );
    expect(text).toContain("JSONExtractString(props, {");
    expect(Object.values(params)).toContain("plan");
    expect(Object.values(params)).toContain("pro");
  });

  it("SECURITY: an injection attempt lands only in params, never in the SQL text", () => {
    const evil = "'; DROP TABLE events; --";
    const { text, params } = compileTrendClickhouse(
      spec({ event: evil, filters: [{ property: evil, op: "eq", value: evil }], breakdown: evil }),
      evil,
    );
    expect(text).not.toContain("DROP TABLE");
    expect(text).not.toContain(evil);
    expect(Object.values(params)).toContain(evil);
  });
});
