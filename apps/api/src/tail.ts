/**
 * Live-tail fan-out (S11). Events flow from a DEDICATED tail consumer group (never the insert consumer's) into
 * this hub, which fans them out to connected SSE clients. Two properties matter:
 *
 * 1. Fan-out isolation. Tail readers consume via their own group, so a slow dashboard tab can never grow the
 *    INSERT consumer's pending list or slow the writer. The observer must not slow the writer.
 * 2. Drop, don't buffer-to-OOM. A live tail's correctness contract is the OPPOSITE of the ingest path's: here
 *    FRESHNESS beats completeness. A slow client gets a bounded ring buffer; when it overflows we drop the
 *    OLDEST frames and COUNT the drops (so the UI can say "… 412 events skipped"). Never back-pressure the
 *    pipeline to keep a slow tab complete.
 */
import type { QueuedEvent } from "@pulse/shared";

export interface TailFilter {
  projectId?: string;
  event?: string;
  distinctId?: string;
}

export interface TailFrame {
  events: QueuedEvent[];
  dropped: number;
}

interface TailClient {
  filter: TailFilter;
  buffer: QueuedEvent[];
  dropped: number;
}

function matches(e: QueuedEvent, f: TailFilter): boolean {
  if (f.projectId && e.projectId !== f.projectId) return false;
  if (f.event && e.name !== f.event) return false;
  if (f.distinctId && e.distinctId !== f.distinctId) return false;
  return true;
}

export class TailHub {
  private readonly clients = new Map<string, TailClient>();
  constructor(private readonly maxBuffer = 100) {}

  subscribe(id: string, filter: TailFilter = {}): void {
    this.clients.set(id, { filter, buffer: [], dropped: 0 });
  }

  unsubscribe(id: string): void {
    this.clients.delete(id);
  }

  clientCount(): number {
    return this.clients.size;
  }

  /** Fan one event out to every matching client, dropping the oldest frame on overflow (freshness > completeness). */
  push(event: QueuedEvent): void {
    for (const client of this.clients.values()) {
      if (!matches(event, client.filter)) continue;
      if (client.buffer.length >= this.maxBuffer) {
        client.buffer.shift(); // drop the OLDEST — a live tail wants recent, not complete
        client.dropped++;
      }
      client.buffer.push(event);
    }
  }

  /** Drain a client's buffered frames + how many were dropped since last drain. */
  drain(id: string): TailFrame {
    const client = this.clients.get(id);
    if (!client) return { events: [], dropped: 0 };
    const events = client.buffer;
    const dropped = client.dropped;
    client.buffer = [];
    client.dropped = 0;
    return { events, dropped };
  }
}
