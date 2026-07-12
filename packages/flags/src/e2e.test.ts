import { describe, it, expect } from "vitest";
import { bucket } from "@pulse/shared";
import { evaluateFlag } from "./evaluate";
import { FlagSpecSchema } from "./spec";
import { computeExperimentResult, type VariantCount } from "./results";

/**
 * End-to-end (S14): the whole loop, DB- and network-free. Create a flag → evaluate it per user exactly as the
 * SDK would (using shared's bucket — the SDK carries a parity-tested copy) → EXPOSE the assigned variant → the
 * variant carries a TRUE effect on conversion → aggregate exposure→goal counts → render results. We inject a
 * real +40% lift and assert the analysis recovers it and calls it significant. This is "create flag → sdk gates a
 * feature → experiment collects → results render" as one runnable proof.
 */
describe("flags→experiment→results e2e (S14)", () => {
  it("recovers an injected treatment effect and reports it as significant", () => {
    const flag = FlagSpecSchema.parse({
      key: "new-onboarding",
      rolloutPercentage: 100,
      variants: [
        { key: "control", weight: 1 },
        { key: "test", weight: 1 },
      ],
    });

    // Injected ground truth: control converts at 10%, test at 14% (+40% relative lift).
    const trueRate: Record<string, number> = { control: 0.1, test: 0.14 };

    // A deterministic "conversion" draw per user, independent of the assignment bucket.
    const convRnd = (id: string): number => bucket("conv-sim", id, "goal");

    const counts = new Map<string, { exposed: number; converted: number }>();
    for (let i = 0; i < 40_000; i++) {
      const id = `user_${i}`;
      // What the SDK would compute locally (byte-parity with shared.bucket, proven in the SDK suite).
      const variant = evaluateFlag(flag, { distinctId: id, properties: {} }, bucket).variant;
      const cell = counts.get(variant) ?? { exposed: 0, converted: 0 };
      cell.exposed++;
      if (convRnd(id) < trueRate[variant]) cell.converted++;
      counts.set(variant, cell);
    }

    const orderedCounts: VariantCount[] = [
      { variant: "control", ...counts.get("control")! },
      { variant: "test", ...counts.get("test")! },
    ];
    const result = computeExperimentResult(orderedCounts);

    // Assignment split is ~50/50.
    expect(orderedCounts[0].exposed).toBeGreaterThan(18_000);
    expect(orderedCounts[1].exposed).toBeGreaterThan(18_000);
    // The analysis recovers roughly the injected +40% lift and calls it significant.
    expect(result.lift).toBeGreaterThan(0.2);
    expect(result.lift).toBeLessThan(0.65);
    expect(result.significant).toBe(true);
    expect(result.liftCiLow).toBeGreaterThan(0); // CI excludes zero → a real effect
  });

  it("an A/A run (no true effect) is reported as NOT significant", () => {
    const flag = FlagSpecSchema.parse({
      key: "aa",
      rolloutPercentage: 100,
      variants: [{ key: "control", weight: 1 }, { key: "test", weight: 1 }],
    });
    const trueRate = 0.1; // identical for both arms
    const counts = new Map<string, { exposed: number; converted: number }>();
    for (let i = 0; i < 40_000; i++) {
      const id = `aa_${i}`;
      const variant = evaluateFlag(flag, { distinctId: id, properties: {} }, bucket).variant;
      const cell = counts.get(variant) ?? { exposed: 0, converted: 0 };
      cell.exposed++;
      if (bucket("aa-conv", id, "goal") < trueRate) cell.converted++;
      counts.set(variant, cell);
    }
    const result = computeExperimentResult([
      { variant: "control", ...counts.get("control")! },
      { variant: "test", ...counts.get("test")! },
    ]);
    expect(result.significant).toBe(false); // no true effect → the honest verdict
  });
});
