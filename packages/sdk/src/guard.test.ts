import { describe, it, expect, vi } from "vitest";
import { guard } from "./guard";

describe("never-throw guard (S03)", () => {
  it("runs the function and returns normally", () => {
    const spy = vi.fn();
    guard(spy);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("swallows a thrown error — never propagates into the host page", () => {
    expect(() =>
      guard(() => {
        throw new Error("boom");
      }),
    ).not.toThrow();
  });

  it("reports the error via onError when provided", () => {
    const onError = vi.fn();
    const err = new Error("boom");
    guard(() => {
      throw err;
    }, onError);
    expect(onError).toHaveBeenCalledWith(err);
  });

  it("an onError that itself throws is still swallowed (reporting must not re-break the page)", () => {
    expect(() =>
      guard(
        () => {
          throw new Error("boom");
        },
        () => {
          throw new Error("reporter broke too");
        },
      ),
    ).not.toThrow();
  });
});
