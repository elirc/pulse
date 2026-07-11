import { describe, it, expect } from "vitest";
import { parseUserAgent, geoLookup, enrich } from "./enrich";
import type { QueuedEvent } from "@pulse/shared";

describe("enrichment (S04)", () => {
  it("parses OS / browser / device from a user-agent", () => {
    const chromeWin =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
    expect(parseUserAgent(chromeWin)).toEqual({ os: "Windows", browser: "Chrome", device: "Desktop" });
    const safariIphone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
    expect(parseUserAgent(safariIphone)).toMatchObject({ os: "iOS", device: "Mobile" });
  });

  it("looks up a country from an IP prefix", () => {
    expect(geoLookup("8.8.8.8")).toBe("US");
    expect(geoLookup("103.1.2.3")).toBe("IN");
    expect(geoLookup("192.168.0.1")).toBe("ZZ");
  });

  it("attaches derived props without dropping the originals", () => {
    const event: QueuedEvent = {
      uuid: "a",
      projectId: "p1",
      distinctId: "u1",
      name: "$pageview",
      props: { $user_agent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120", $ip: "8.8.8.8", plan: "pro" },
      ts: "2026-07-11T00:00:00.000Z",
      ingestedAt: "2026-07-11T00:00:01.000Z",
    };
    const out = enrich(event);
    expect(out.props).toMatchObject({ plan: "pro", $os: "Windows", $browser: "Chrome", $geo_country: "US" });
  });
});
