import { describe, it, expect } from "vitest";
import { compileTrendSql } from "./sql";
import { TrendSpecSchema } from "./spec";

const spec = (over: Record<string, unknown> = {}): ReturnType<typeof TrendSpecSchema.parse> =>
  TrendSpecSchema.parse(over);

describe("compileTrendSql (S05)", () => {
  it("counts all events by day with projectId + window as params", () => {
    const { text, params } = compileTrendSql(spec(), "proj1");
    expect(text).toContain("count(*)");
    expect(text).toContain("date_trunc('day', \"ts\")");
    expect(text).toContain('"projectId" = $1');
    expect(params[0]).toBe("proj1");
    expect(params).toContain(30); // default lookback window
  });

  it("unique persons uses count(distinct distinctId)", () => {
    const { text } = compileTrendSql(spec({ metric: "unique" }), "p1");
    expect(text).toContain('count(distinct "distinctId")');
  });

  it("event name and property filters are bound params, not inlined", () => {
    const { text, params } = compileTrendSql(
      spec({ event: "purchase", filters: [{ property: "plan", op: "eq", value: "pro" }] }),
      "p1",
    );
    expect(text).toContain('"name" = $');
    expect(text).toContain('("props" ->> $'); // property name is parameterized
    expect(params).toContain("purchase");
    expect(params).toContain("plan");
    expect(params).toContain("pro");
  });

  it("breakdown adds a parameterized JSONB column and GROUP BY 1, 2", () => {
    const { text, params } = compileTrendSql(spec({ breakdown: "$browser" }), "p1");
    expect(text).toMatch(/\("props" ->> \$\d+\) AS label/);
    expect(text).toContain("GROUP BY 1, 2");
    expect(params).toContain("$browser");
  });

  it("SECURITY: a SQL-injection attempt lands only in params, never in the SQL text", () => {
    const evil = "'; DROP TABLE \"Event\"; --";
    const { text, params } = compileTrendSql(
      spec({ event: evil, filters: [{ property: evil, op: "eq", value: evil }], breakdown: evil }),
      evil,
    );
    expect(text).not.toContain("DROP TABLE");
    expect(text).not.toContain(evil);
    expect(params).toContain(evil); // it's data, bound safely
  });

  it("interval is inlined only from the closed enum (day/week/month)", () => {
    expect(compileTrendSql(spec({ interval: "week" }), "p1").text).toContain("date_trunc('week'");
    expect(compileTrendSql(spec({ interval: "month" }), "p1").text).toContain("date_trunc('month'");
  });
});
