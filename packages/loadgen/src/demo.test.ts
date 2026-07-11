import { describe, it, expect } from "vitest";
import { generateDemoData } from "./demo";

const END = 1_760_000_000_000; // pinned for reproducibility

describe("demo data generator (S05)", () => {
  it("is deterministic given the same seed + window", () => {
    const a = generateDemoData({ users: 50, days: 30, seed: 7, endMs: END });
    const b = generateDemoData({ users: 50, days: 30, seed: 7, endMs: END });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(50);
  });

  it("produces a real funnel staircase (each step ≤ the previous)", () => {
    const data = generateDemoData({ users: 500, days: 30, seed: 7, endMs: END });
    const count = (name: string): number => data.filter((e) => e.name === name).length;
    const pageview = count("$pageview");
    const started = count("signup_started");
    const completed = count("signup_completed");
    const purchase = count("purchase");
    expect(pageview).toBeGreaterThan(started);
    expect(started).toBeGreaterThan(completed);
    expect(completed).toBeGreaterThan(purchase);
    expect(purchase).toBeGreaterThan(0);
  });

  it("spreads events across the whole window and carries persona props", () => {
    const data = generateDemoData({ users: 100, days: 30, seed: 3, endMs: END });
    const times = data.map((e) => Number(e.ts));
    expect(Math.min(...times)).toBeGreaterThanOrEqual(END - 30 * 24 * 60 * 60 * 1000);
    expect(Math.max(...times)).toBeLessThanOrEqual(END + 4000);
    expect(data[0].props).toHaveProperty("$browser");
  });
});
