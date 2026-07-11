/**
 * Live events feed (S05): the latest events for a project, polled every 5 seconds — the view analysts stare at
 * during setup to confirm events are flowing. A rolling table, newest at the top.
 */
import { useEffect, useState } from "react";
import { apiGet } from "./lib/api";

interface LiveEvent {
  id: string;
  name: string;
  distinctId: string;
  ts: string;
}

export function Live(): JSX.Element {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = (): void => {
      apiGet<LiveEvent[]>("/events/live")
        .then((e) => !cancelled && setEvents(e))
        .catch((e: unknown) => !cancelled && setErr(String(e)));
    };
    poll();
    const timer = window.setInterval(poll, 5000); // 5s polling
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section>
      <h2 style={{ color: "#f2545b" }}>Live events</h2>
      <p style={{ color: "#8b93a1", fontSize: 12 }}>Latest 100, refreshing every 5s.</p>
      {err && <p style={{ color: "salmon" }}>Couldn’t reach the API ({err}).</p>}
      {events.length === 0 && !err && <p style={{ color: "#8b93a1" }}>No events yet — fire one from the SDK or loadgen.</p>}
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
              {events.map((e) => (
                <tr key={e.id} style={{ borderTop: "1px solid #232a32", color: "#c9d1d9" }}>
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
