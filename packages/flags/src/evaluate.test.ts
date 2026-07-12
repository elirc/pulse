import { describe, it, expect } from "vitest";
import { evaluateFlag, type BucketFn } from "./evaluate";
import { FlagSpecSchema } from "./spec";

const flag = (over: Record<string, unknown> = {}) =>
  FlagSpecSchema.parse({ key: "new-checkout", variants: [{ key: "control" }, { key: "test" }], ...over });

// A fake bucketer we fully control: returns a fixed draw per salt.
const fixed = (draws: Record<string, number>): BucketFn => (_k, _id, salt = "") => draws[salt] ?? 0.5;

describe("evaluateFlag (S14)", () => {
  it("disabled flag returns the control variant", () => {
    const e = evaluateFlag(flag({ enabled: false }), { distinctId: "u1", properties: {} }, fixed({}));
    expect(e).toEqual({ flagKey: "new-checkout", variant: "control", reason: "disabled" });
  });

  it("untargeted user (predicate fails) gets control", () => {
    const f = flag({ targeting: [{ property: "plan", op: "eq", value: "pro" }] });
    const e = evaluateFlag(f, { distinctId: "u1", properties: { plan: "free" } }, fixed({ rollout: 0 }));
    expect(e.reason).toBe("not_targeted");
    expect(e.variant).toBe("control");
  });

  it("user above the rollout bucket gets control (out_of_rollout)", () => {
    const f = flag({ rolloutPercentage: 30 });
    // rollout draw 0.5 >= 0.30 → out
    const e = evaluateFlag(f, { distinctId: "u1", properties: {} }, fixed({ rollout: 0.5 }));
    expect(e.reason).toBe("out_of_rollout");
  });

  it("user inside the rollout is assigned a variant by the variant draw", () => {
    const f = flag({ rolloutPercentage: 100, variants: [{ key: "control", weight: 1 }, { key: "test", weight: 1 }] });
    // rollout 0 → in; variant draw 0.75 * total(2) = 1.5 → second bucket ("test")
    const e = evaluateFlag(f, { distinctId: "u1", properties: {} }, fixed({ rollout: 0, variant: 0.75 }));
    expect(e.reason).toBe("rollout");
    expect(e.variant).toBe("test");
    // variant draw 0.1 * 2 = 0.2 → first bucket ("control")
    const e2 = evaluateFlag(f, { distinctId: "u1", properties: {} }, fixed({ rollout: 0, variant: 0.1 }));
    expect(e2.variant).toBe("control");
  });

  it("respects unequal variant weights", () => {
    const f = flag({ rolloutPercentage: 100, variants: [{ key: "a", weight: 9 }, { key: "b", weight: 1 }] });
    // draw 0.85 * total(10) = 8.5 → still within a's 9 → "a"
    expect(evaluateFlag(f, { distinctId: "u1", properties: {} }, fixed({ rollout: 0, variant: 0.85 })).variant).toBe("a");
    // draw 0.95 * 10 = 9.5 → past a(9) → "b"
    expect(evaluateFlag(f, { distinctId: "u1", properties: {} }, fixed({ rollout: 0, variant: 0.95 })).variant).toBe("b");
  });
});
