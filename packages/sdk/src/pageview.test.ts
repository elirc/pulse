import { describe, it, expect, vi, afterEach } from "vitest";
import { installAutoPageview } from "./pageview";

let teardown: (() => void) | null = null;
afterEach(() => {
  teardown?.();
  teardown = null;
});

describe("auto pageview patching (S03)", () => {
  it("emits on pushState and still runs the original (composes, doesn't clobber)", () => {
    const emit = vi.fn();
    teardown = installAutoPageview(emit);
    history.pushState({}, "", "/composed");
    expect(emit).toHaveBeenCalledOnce();
    expect(location.pathname).toBe("/composed"); // original pushState ran
  });

  it("emits on popstate (back/forward)", () => {
    const emit = vi.fn();
    teardown = installAutoPageview(emit);
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(emit).toHaveBeenCalledOnce();
  });

  it("is idempotent — a second install does not stack patches or double-emit", () => {
    const emit = vi.fn();
    const t1 = installAutoPageview(emit);
    const t2 = installAutoPageview(emit); // no-op
    history.pushState({}, "", "/once");
    expect(emit).toHaveBeenCalledTimes(1);
    t1();
    t2();
  });

  it("teardown restores the original history — leaves no trace", () => {
    const before = history.pushState;
    teardown = installAutoPageview(vi.fn());
    expect(history.pushState).not.toBe(before);
    teardown();
    teardown = null;
    expect(history.pushState).toBe(before);
  });
});
