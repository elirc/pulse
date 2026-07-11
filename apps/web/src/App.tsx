import { useEffect, useState } from "react";
import { apiGet } from "./lib/api";

interface DailyCount {
  day: string;
  count: number;
}

/**
 * The analyst shell (S01). One insight — a daily-count line chart over the event firehose — rendered from
 * `/insights/daily-counts`. This is the "chart" end of the walking skeleton (SDK → ingest → events → chart).
 * Trends, funnels, retention, and dashboards build out from here (S05+). A tiny inline SVG line, no chart lib.
 */
export function App(): JSX.Element {
  const [data, setData] = useState<DailyCount[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiGet<DailyCount[]>("/insights/daily-counts")
      .then(setData)
      .catch((e: unknown) => setErr(String(e)));
  }, []);

  const max = Math.max(1, ...data.map((d) => d.count));
  const W = 640;
  const H = 200;
  const points = data.map((d, i) => {
    const x = data.length > 1 ? (i / (data.length - 1)) * (W - 20) + 10 : W / 2;
    const y = H - 20 - (d.count / max) * (H - 40);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: "0 16px", fontFamily: "system-ui, sans-serif", color: "#e6edf3" }}>
      <h1 style={{ color: "#f2545b" }}>Pulse · Events per day</h1>
      {err && <p style={{ color: "salmon" }}>Couldn’t reach the API ({err}). Is it running on :3001?</p>}
      {data.length === 0 && !err && <p style={{ color: "#8b93a1" }}>No events yet — point the SDK (or the loadgen) at the ingest server.</p>}
      {data.length > 0 && (
        <svg width={W} height={H} style={{ border: "1px solid #232a32", borderRadius: 10, background: "#0d1117" }}>
          <polyline fill="none" stroke="#f2545b" strokeWidth="2" points={points.join(" ")} />
          {data.map((d, i) => {
            const [x, y] = points[i].split(",");
            return <circle key={d.day} cx={x} cy={y} r="2.5" fill="#f2545b" />;
          })}
        </svg>
      )}
      <p style={{ color: "#5b6572", fontSize: 12, marginTop: 20 }}>
        Walking skeleton: SDK → ingest (a separate deployable) → a naive Postgres events table → this chart. The
        events store stays on Postgres <em>on purpose</em> until S07 measures it across the ADR-0002 exit criteria.
      </p>
    </main>
  );
}
