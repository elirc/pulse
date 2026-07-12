/**
 * Scheduled email reports (S10). Render a dashboard server-side into an email SNAPSHOT and send it. The one
 * semantic worth stating (in the footer): this is a point-in-time snapshot taken at send, NOT a live link —
 * otherwise a recipient reads "yesterday's numbers" as "now" and makes a decision on stale data. `renderReport`
 * is pure and tested; the transport is a port (in-memory for tests, SMTP/mailpit in prod).
 */
export interface TileSnapshot {
  insightId: string;
  computedAt: string;
  value: unknown;
}

export interface DashboardSnapshot {
  name: string;
  tiles: TileSnapshot[];
  generatedAt: string;
}

export interface EmailTransport {
  send(to: string, subject: string, html: string): Promise<void>;
}

export function renderReport(snapshot: DashboardSnapshot): { subject: string; html: string } {
  const subject = `Your Pulse report: ${snapshot.name}`;
  const rows = snapshot.tiles
    .map((t) => `<tr><td>${t.insightId}</td><td><pre>${JSON.stringify(t.value)}</pre></td></tr>`)
    .join("");
  const html =
    `<h1>${snapshot.name}</h1>` +
    `<table>${rows}</table>` +
    `<p style="color:#888;font-size:12px">Snapshot taken ${snapshot.generatedAt}. This is a point-in-time ` +
    `snapshot, not a live link — the numbers were current as of the timestamps above.</p>`;
  return { subject, html };
}

export async function sendReport(
  snapshot: DashboardSnapshot,
  to: string,
  transport: EmailTransport,
): Promise<void> {
  const { subject, html } = renderReport(snapshot);
  await transport.send(to, subject, html);
}

/** In-memory transport for tests. */
export class InMemoryEmailTransport implements EmailTransport {
  public readonly sent: Array<{ to: string; subject: string; html: string }> = [];
  send(to: string, subject: string, html: string): Promise<void> {
    this.sent.push({ to, subject, html });
    return Promise.resolve();
  }
}
