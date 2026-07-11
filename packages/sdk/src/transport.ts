/**
 * Transport (S03). In this first cut it sends each event immediately — the honest minimum. Batching, flush
 * triggers, sendBeacon, and retries arrive in later commits; the `Transport` interface stays stable so the
 * Pulse core never has to know which one it's talking to. The wire body is always a JSON ARRAY of envelopes
 * (a batch of one for now), so the server contract doesn't change when real batching lands.
 */
import type { EventEnvelope } from "./types";

export interface Transport {
  enqueue(event: EventEnvelope): void;
  /** Best-effort synchronous-ish flush (used on unload in later commits). */
  flush(): void;
}

export type SendFn = (batch: EventEnvelope[]) => Promise<boolean>;

/** Build the default network sender: POST a JSON array to `${apiHost}/e` with the public write key. */
export function httpSend(apiHost: string, writeKey: string, fetchImpl: typeof fetch = fetch): SendFn {
  return async (batch) => {
    const res = await fetchImpl(`${apiHost}/e`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${writeKey}` },
      body: JSON.stringify(batch),
      keepalive: true,
    });
    return res.ok;
  };
}

/** The commit-1 transport: fire each event at the network immediately, swallow failures. */
export class ImmediateTransport implements Transport {
  constructor(private readonly send: SendFn) {}

  enqueue(event: EventEnvelope): void {
    void this.send([event]).catch(() => {});
  }

  flush(): void {
    /* nothing buffered in the immediate transport */
  }
}
