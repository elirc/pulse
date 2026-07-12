/**
 * Enrichment (S04). Before an event is stored, we derive useful attributes the SDK didn't send: the device /
 * OS / browser from the user-agent string, and a country from the client IP. These become queryable props
 * ($os, $browser, $device, $geo_country) that power "top browsers" and geo breakdowns without the customer
 * having to instrument them.
 *
 * UA parsing is a set of ordered regex checks; geo is a lookup against a local database (an mmdb file in
 * production; a small prefix table here). Each event is enriched as it passes through the consumer.
 */
import type { QueuedEvent } from "@pulse/shared";

interface UaInfo {
  os: string;
  browser: string;
  device: string;
}

export function parseUserAgent(ua: string): UaInfo {
  // Order matters: iPhone/iPad UAs contain "like Mac OS X", and Android contains "Linux" — so check the more
  // specific mobile platforms BEFORE the desktop ones they impersonate.
  const os = /Windows/i.test(ua)
    ? "Windows"
    : /iPhone|iPad|iPod|iOS/i.test(ua)
      ? "iOS"
      : /Android/i.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/i.test(ua)
          ? "macOS"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Unknown";
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /Chrome\//i.test(ua)
      ? "Chrome"
      : /Firefox\//i.test(ua)
        ? "Firefox"
        : /Safari\//i.test(ua)
          ? "Safari"
          : "Unknown";
  const device = /Mobile|Android|iPhone/i.test(ua) ? "Mobile" : /iPad|Tablet/i.test(ua) ? "Tablet" : "Desktop";
  return { os, browser, device };
}

// A tiny stand-in for a GeoIP database: first octet → country. Production loads a real mmdb.
const GEO_PREFIXES: Array<[string, string]> = [
  ["8.", "US"],
  ["24.", "US"],
  ["31.", "GB"],
  ["41.", "ZA"],
  ["49.", "JP"],
  ["77.", "DE"],
  ["103.", "IN"],
  ["200.", "BR"],
];

export function geoLookup(ip: string): string {
  for (const [prefix, country] of GEO_PREFIXES) {
    if (ip.startsWith(prefix)) return country;
  }
  return "ZZ"; // unknown
}

/** Attach derived $os/$browser/$device/$geo_country to an event's props. */
export function enrich(event: QueuedEvent): QueuedEvent {
  const ua = typeof event.props.$user_agent === "string" ? event.props.$user_agent : "";
  const ip = typeof event.props.$ip === "string" ? event.props.$ip : "";
  const { os, browser, device } = parseUserAgent(ua);
  return {
    ...event,
    props: { ...event.props, $os: os, $browser: browser, $device: device, $geo_country: geoLookup(ip) },
  };
}

/**
 * Batch enrichment (S07) — the harvest of flaw #2. The old path called enrich() per event inside the consumer
 * loop, re-parsing the SAME user-agent string and re-looking-up the SAME ip for every event in a session (a
 * batch is usually one user's burst — hundreds of events, a handful of distinct UAs/ips). Memoizing the parse
 * per DISTINCT value across the batch turns O(events) expensive parses into O(distinct-values). Same output,
 * far less work — vectorize over the batch instead of grinding it one row at a time.
 */
export function batchEnrich(events: QueuedEvent[]): QueuedEvent[] {
  const uaCache = new Map<string, UaInfo>();
  const geoCache = new Map<string, string>();
  return events.map((event) => {
    const ua = typeof event.props.$user_agent === "string" ? event.props.$user_agent : "";
    const ip = typeof event.props.$ip === "string" ? event.props.$ip : "";
    let uaInfo = uaCache.get(ua);
    if (!uaInfo) uaCache.set(ua, (uaInfo = parseUserAgent(ua)));
    let country = geoCache.get(ip);
    if (country === undefined) geoCache.set(ip, (country = geoLookup(ip)));
    return {
      ...event,
      props: { ...event.props, $os: uaInfo.os, $browser: uaInfo.browser, $device: uaInfo.device, $geo_country: country },
    };
  });
}
