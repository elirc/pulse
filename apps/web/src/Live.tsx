/**
 * Live events feed (S11) — now a real-time TAIL over Server-Sent Events, not a raw-table poll. Replaces the S05
 * polling feed (flaw #4): that queried the events table every 5s ordered by an unindexed column, a full scan on
 * a growing table for every viewer. The SSE tail streams from a dedicated fan-out consumer group instead — the
 * data comes to us, off the storage path entirely.
 */
import { useEffect, useState } from "react";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";

interface TailEvent {
  name: string;
  distinctId: string;
  ts: string;
}
interface TailFrame {
  events: TailEvent[];
  dropped: number;
}

export function Live(): JSX.Element {
  const [events, setEvents] = useState<TailEvent[]>([]);
  const [dropped, setDropped] = useState(0);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource(`${BASE}/events/tail`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      const frame = JSON.parse(msg.data as string) as TailFrame;
      if (frame.dropped) setDropped((d) => d + frame.dropped);
      if (frame.events.length) setEvents((prev) => [...frame.events.reverse(), ...prev].slice(0, 100));
    };
    return () => es.close();
  }, []);

  return (
    <section>
      <h2 style={{ color: "#f2545b" }}>Live events</h2>
      <p style={{ color: "#8b93a1", fontSize: 12 }}>
        Streaming (SSE) {connected ? "· connected" : "· connecting…"}
        {dropped > 0 && <span style={{ color: "#f2a154" }}> · {dropped} skipped (slow connection)</span>}
      </p>
      {events.length === 0 && <p style={{ color: "#8b93a1" }}>Waiting for events — fire one from the SDK or loadgen.</p>}
      {events.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "#8b93a1", textAlign: "left" }}>
                <th style={{ padding: "6px 12px 6px 0" }}>Event</th>
                <th style={{ padding: "6px 12px 6px 0" }}>Person</th>
                <th style={{ padding: "6px 0" }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={i} style={{ borderTop: "1px solid #232a32", color: "#c9d1d9" }}>
                  <td style={{ padding: "6px 12px 6px 0", color: "#f2545b", fontFamily: "monospace" }}>{e.name}</td>
                  <td style={{ padding: "6px 12px 6px 0", fontFamily: "monospace" }}>{e.distinctId}</td>
                  <td style={{ padding: "6px 0", color: "#8b93a1" }}>{e.ts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
