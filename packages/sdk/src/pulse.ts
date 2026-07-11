/**
 * The Pulse instance (S03) — orchestrates identity + transport behind the tiny public API. In this first cut
 * it can `init` and `capture`; identity persistence, batching, beacons, retries, and auto-pageview build out
 * from here across the sprint. The distinctId is a plain field for now (persisted in the next commit).
 */
import type { EventEnvelope, PulseOptions } from "./types";
import { uuid } from "./id";
import { ImmediateTransport, httpSend, type Transport } from "./transport";

const DEFAULT_HOST = "https://ingest.pulse.example";

export class Pulse {
  private transport: Transport | null = null;
  private distinctId = "";

  init(options: PulseOptions): void {
    const host = options.apiHost ?? DEFAULT_HOST;
    this.transport = new ImmediateTransport(httpSend(host, options.writeKey));
    this.distinctId = uuid(); // anonymous, ephemeral until the next commit persists it
  }

  capture(name: string, props: Record<string, unknown> = {}): void {
    if (!this.transport) return; // capture before init is a no-op, not a crash
    const event: EventEnvelope = {
      uuid: uuid(),
      name,
      distinctId: this.distinctId,
      props,
      ts: new Date().toISOString(),
    };
    this.transport.enqueue(event);
  }
}
