/**
 * The Pulse instance (S03) — orchestrates identity + transport behind the tiny public API. Batching, beacons,
 * retries, and auto-pageview build out from here across the sprint.
 */
import type { EventEnvelope, PulseOptions } from "./types";
import { loadOrCreateDistinctId, uuid, DISTINCT_ID_KEY } from "./id";
import { browserStorage, type SafeStorage } from "./storage";
import { BatchTransport, httpSend, type Transport } from "./transport";

const DEFAULT_HOST = "https://ingest.pulse.example";

export interface PulseDeps {
  storage?: SafeStorage;
  transport?: Transport;
}

export class Pulse {
  private transport: Transport | null = null;
  private storage: SafeStorage = browserStorage();
  private distinctId = "";

  constructor(private readonly deps: PulseDeps = {}) {
    if (deps.storage) this.storage = deps.storage;
  }

  init(options: PulseOptions): void {
    const host = options.apiHost ?? DEFAULT_HOST;
    this.transport =
      this.deps.transport ??
      new BatchTransport({
        send: httpSend(host, options.writeKey),
        flushAt: options.flushAt,
        flushIntervalMs: options.flushIntervalMs,
      });
    this.distinctId = loadOrCreateDistinctId(this.storage);
    this.installLifecycleFlush();
  }

  /** The visibility/unload flush trigger: flush when the tab is hidden or closing. The unload path upgrades to
   *  sendBeacon in the next commit; here it's a best-effort flush so the last batch isn't stranded. */
  private installLifecycleFlush(): void {
    if (typeof document === "undefined") return; // non-DOM host (tests without jsdom, SSR)
    const flush = (): void => this.transport?.flush();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    globalThis.addEventListener?.("pagehide", flush);
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

  /**
   * Bind this browser to a known user id. Events *after* this carry it. Events captured *before* it still carry
   * the anonymous id — stitching those to the identified person is the ALIAS problem, and it is genuinely hard
   * (races, multiple devices, replays). Named here, deferred to S06, which exists largely because of it.
   */
  identify(distinctId: string): void {
    this.distinctId = distinctId;
    this.storage.set(DISTINCT_ID_KEY, distinctId);
  }

  /** Forget the current identity (logout): drop the stored id and start a fresh anonymous one. */
  reset(): void {
    this.storage.remove(DISTINCT_ID_KEY);
    this.distinctId = loadOrCreateDistinctId(this.storage);
  }

  /** Current distinct id (mostly for tests/debugging). */
  getDistinctId(): string {
    return this.distinctId;
  }
}
