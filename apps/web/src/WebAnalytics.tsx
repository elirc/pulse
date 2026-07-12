/**
 * Web analytics overview (S11). Visitors, pageviews, top pages / referrers / UTM, and a live "online now"
 * counter. Deliberately NO new query engine — every panel is a saved-insight-shaped trend query breakdown, run
 * through the S05 compiler. Web analytics is saved-insights-in-a-trenchcoat: the "product" is a curated set of
 * the queries the general engine already answers.
 */
import { useEffect, useState } from "react";
import { apiGet, apiPost } from "./lib/api";

interface Row {
  bucket: string;
  label: string | null;
  value: number;
}

const RED = "#f2545b";

function useTrend(spec: Record<string, unknown>): Row[] {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    apiPost<Row[]>("/insights/trend", { spec })
      .then(setRows)
      .catch(() => setRows([]));
  }, []); // eslint-disable-line
  return rows;
}

function TopList({ title, rows }: { title: string; rows: Row[] }): JSX.Element {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.label ?? "(none)", (totals.get(r.label ?? "(none)") ?? 0) + r.value);
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return (
    <div>
      <h3 style={{ color: "#c9d1d9", fontSize: 14 }}>{title}</h3>
      <ul style={{ listStyle: "none", padding: 0, color: "#c9d1d9", fontSize: 13 }}>
        {top.map(([label, n]) => (
          <li key={label} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #232a32", padding: "4px 0" }}>
            <span style={{ fontFamily: "monospace" }}>{label}</span>
            <span style={{ color: "#8b93a1" }}>{n.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WebAnalytics(): JSX.Element {
  const [online, setOnline] = useState<number | null>(null);
  const pageviews = useTrend({ event: "$pageview", metric: "total", interval: "day", days: 30 });
  const visitors = useTrend({ event: "$pageview", metric: "unique", interval: "day", days: 30 });
  const topPages = useTrend({ event: "$pageview", breakdown: "$pathname", days: 30 });
  const topReferrers = useTrend({ event: "$pageview", breakdown: "$referrer", days: 30 });
  const topUtm = useTrend({ event: "$pageview", breakdown: "$utm_source", days: 30 });

  useEffect(() => {
    const poll = (): void => void apiGet<{ online: number }>("/online").then((r) => setOnline(r.online)).catch(() => setOnline(null));
    poll();
    const t = window.setInterval(poll, 5000);
    return () => window.clearInterval(t);
  }, []);

  const sum = (rows: Row[]): number => rows.reduce((a, r) => a + r.value, 0);

  return (
    <section>
      <h2 style={{ color: RED }}>Web analytics</h2>
      <div style={{ display: "flex", gap: 24, marginBottom: 20 }}>
        <Stat label="Online now" value={online ?? "—"} live />
        <Stat label="Pageviews (30d)" value={sum(pageviews).toLocaleString()} />
        <Stat label="Visitors (30d)" value={sum(visitors).toLocaleString()} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24 }}>
        <TopList title="Top pages" rows={topPages} />
        <TopList title="Top referrers" rows={topReferrers} />
        <TopList title="Top UTM sources" rows={topUtm} />
      </div>
    </section>
  );
}

function Stat({ label, value, live }: { label: string; value: string | number; live?: boolean }): JSX.Element {
  return (
    <div>
      <div style={{ color: "#8b93a1", fontSize: 12 }}>
        {label} {live && <span style={{ color: "#54f2a1" }}>●</span>}
      </div>
      <div style={{ color: "#e6edf3", fontSize: 28, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
