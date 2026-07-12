import { useEffect, useState } from "react";
import { apiGet } from "./lib/api";
import { Setup } from "./Setup";
import { Docs } from "./Docs";
import { Insights } from "./Insights";
import { Funnels } from "./Funnels";
import { Retention } from "./Retention";
import { Dashboard } from "./Dashboard";
import { WebAnalytics } from "./WebAnalytics";
import { Live } from "./Live";
import { Persons } from "./Persons";

interface DailyCount {
  day: string;
  count: number;
}

type View = "insights" | "dashboard" | "trends" | "funnels" | "retention" | "web" | "live" | "persons" | "setup" | "docs";

/**
 * The analyst shell (S01). One insight — a daily-count line chart over the event firehose — rendered from
 * `/insights/daily-counts`. This is the "chart" end of the walking skeleton (SDK → ingest → events → chart).
 * Trends, funnels, retention, and dashboards build out from here (S05+). A tiny inline SVG line, no chart lib.
 */
export function App(): JSX.Element {
  const [view, setView] = useState<View>("insights");
  const [data, setData] = useState<DailyCount[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiGet<DailyCount[]>("/insights/daily-counts")
      .then(setData)
      .catch((e: unknown) => setErr(String(e)));
  }, []);

  const tab = (v: View, label: string): JSX.Element => (
    <button
      onClick={() => setView(v)}
      style={{
        background: "none",
        border: "none",
        borderBottom: view === v ? "2px solid #f2545b" : "2px solid transparent",
        color: view === v ? "#f2545b" : "#8b93a1",
        cursor: "pointer",
        fontSize: 14,
        padding: "6px 4px",
      }}
    >
      {label}
    </button>
  );

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
      <h1 style={{ color: "#f2545b" }}>Pulse</h1>
      <nav style={{ display: "flex", gap: 16, borderBottom: "1px solid #232a32", marginBottom: 24 }}>
        {tab("insights", "Events per day")}
        {tab("dashboard", "Dashboard")}
        {tab("trends", "Insights")}
        {tab("funnels", "Funnels")}
        {tab("retention", "Retention")}
        {tab("web", "Web")}
        {tab("live", "Live")}
        {tab("persons", "Persons")}
        {tab("setup", "Setup")}
        {tab("docs", "SDK Docs")}
      </nav>
      {view === "dashboard" && <Dashboard />}
      {view === "trends" && <Insights />}
      {view === "funnels" && <Funnels />}
      {view === "retention" && <Retention />}
      {view === "web" && <WebAnalytics />}
      {view === "live" && <Live />}
      {view === "persons" && <Persons />}
      {view === "docs" && <Docs />}
      {view === "setup" && <Setup />}
      {view === "insights" && (
        <>
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
        </>
      )}
    </main>
  );
}
