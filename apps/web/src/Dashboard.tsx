/**
 * Dashboard grid (S10). Renders a dashboard's tiles; each tile shows its insight's cached result with a
 * STALENESS BADGE (computedAt) and a refresh button. The staleness UI is carried from S09's norm: a cached
 * number that can't say how old it is is a number that lies.
 */
import { useEffect, useState } from "react";
import { apiGet } from "./lib/api";

interface Tile {
  id: string;
  insightId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface DashboardData {
  id: string;
  name: string;
  tiles: Tile[];
}
interface TileResult {
  value: unknown;
  computedAt: string;
  cached: boolean;
}

const RED = "#f2545b";

function TileCard({ tile }: { tile: Tile }): JSX.Element {
  const [result, setResult] = useState<TileResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = (refresh = false): void => {
    setErr(null);
    apiGet<TileResult>(`/insights/${tile.insightId}/result${refresh ? "?refresh=1" : ""}`)
      .then(setResult)
      .catch((e: unknown) => setErr(String(e)));
  };
  useEffect(() => load(), []);

  const ageMin = result ? Math.round((Date.now() - new Date(result.computedAt).getTime()) / 60000) : 0;

  return (
    <div style={{ gridColumn: `span ${tile.w}`, border: "1px solid #232a32", borderRadius: 10, padding: 12, background: "#0d1117" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ color: "#8b93a1", fontSize: 12 }}>insight {tile.insightId.slice(0, 8)}</span>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {result && (
            <span title={result.computedAt} style={{ color: ageMin > 10 ? "#f2a154" : "#5b6572", fontSize: 11 }}>
              {result.cached ? "cached" : "fresh"} · {ageMin}m old
            </span>
          )}
          <button onClick={() => load(true)} style={{ background: "none", border: "1px solid #232a32", borderRadius: 4, color: RED, cursor: "pointer", fontSize: 11, padding: "2px 6px" }}>
            ↻
          </button>
        </span>
      </div>
      {err && <p style={{ color: "#8b93a1", fontSize: 12 }}>—</p>}
      {result && <pre style={{ color: "#c9d1d9", fontSize: 11, overflowX: "auto", margin: 0 }}>{JSON.stringify(result.value, null, 1).slice(0, 400)}</pre>}
    </div>
  );
}

export function Dashboard({ dashboardId = "demo" }: { dashboardId?: string }): JSX.Element {
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiGet<DashboardData>(`/dashboards/${dashboardId}`)
      .then(setDash)
      .catch((e: unknown) => setErr(String(e)));
  }, [dashboardId]);

  return (
    <section>
      <h2 style={{ color: RED }}>{dash?.name ?? "Dashboard"}</h2>
      {err && <p style={{ color: "#8b93a1" }}>No dashboard yet — create one and add tiles ({err}).</p>}
      {dash && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 12 }}>
          {dash.tiles.map((t) => (
            <TileCard key={t.id} tile={t} />
          ))}
        </div>
      )}
    </section>
  );
}
