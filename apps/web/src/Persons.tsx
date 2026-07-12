/**
 * Person profile (S06). Look up a distinctId → resolve to a person → show their properties, the list of ids
 * that merged into them, and their event timeline. Makes the identity graph visible: one human, many ids.
 */
import { useState } from "react";
import { apiGet } from "./lib/api";

interface Profile {
  id: string;
  properties: Record<string, unknown>;
  createdAt: string;
  distinctIds: string[];
}
interface TimelineEvent {
  id: string;
  name: string;
  ts: string;
}

const RED = "#f2545b";
const field: React.CSSProperties = {
  background: "#0d1117",
  border: "1px solid #232a32",
  borderRadius: 6,
  color: "#e6edf3",
  padding: "6px 8px",
  fontSize: 13,
};

export function Persons(): JSX.Element {
  const [distinctId, setDistinctId] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const lookup = async (): Promise<void> => {
    setErr(null);
    setProfile(null);
    setEvents([]);
    try {
      const { personId } = await apiGet<{ personId: string }>(
        `/persons/resolve?distinctId=${encodeURIComponent(distinctId)}`,
      );
      const [p, ev] = await Promise.all([
        apiGet<Profile>(`/persons/${personId}`),
        apiGet<TimelineEvent[]>(`/persons/${personId}/events`),
      ]);
      setProfile(p);
      setEvents(ev);
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <section>
      <h2 style={{ color: RED }}>Person profile</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input style={field} value={distinctId} onChange={(e) => setDistinctId(e.target.value)} placeholder="a distinctId (anon or user id)" />
        <button onClick={() => void lookup()} style={{ ...field, background: RED, borderColor: RED, cursor: "pointer" }}>
          Look up
        </button>
      </div>
      {err && <p style={{ color: "#8b93a1" }}>No person found for that id ({err}).</p>}
      {profile && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <h3 style={{ color: "#c9d1d9" }}>Properties</h3>
            <pre style={{ ...field, overflowX: "auto" }}>{JSON.stringify(profile.properties, null, 2)}</pre>
            <h3 style={{ color: "#c9d1d9" }}>Merged ids ({profile.distinctIds.length})</h3>
            <ul style={{ color: "#8b93a1", fontFamily: "monospace", fontSize: 12 }}>
              {profile.distinctIds.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 style={{ color: "#c9d1d9" }}>Timeline</h3>
            <ul style={{ color: "#c9d1d9", fontSize: 13, listStyle: "none", padding: 0 }}>
              {events.map((e) => (
                <li key={e.id} style={{ borderTop: "1px solid #232a32", padding: "6px 0" }}>
                  <span style={{ color: RED, fontFamily: "monospace" }}>{e.name}</span>{" "}
                  <span style={{ color: "#8b93a1" }}>{e.ts}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
