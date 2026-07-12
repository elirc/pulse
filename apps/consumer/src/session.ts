/**
 * Session-ization (S11): stamp a `$session_id` at INGEST time (in the consumer enrichment), not reconstruct it at
 * query time. Sessions are queried constantly, defined stably, and cheap to compute in-stream — the "resolve at
 * write" grid (S06) applied again: pay once at write, keep every query a simple GROUP BY $session_id.
 *
 * A session is a contiguous run of a distinctId's activity; a gap longer than the threshold (30 minutes,
 * default) starts a new one. The threshold is a lore-encrusted DEFAULT, not truth, so it's a setting — and the
 * session-definition VERSION is stamped next to the data (`$session_v`) so a future change to the rule is
 * analyzable rather than silently rewriting history.
 */
import { randomUUID } from "node:crypto";
import type { QueuedEvent } from "@pulse/shared";

export const SESSION_DEF_VERSION = 1;
const DEFAULT_GAP_MS = 30 * 60 * 1000;

export interface SessionState {
  sessionId: string;
  lastSeenMs: number;
}

export interface SessionStore {
  get(key: string): Promise<SessionState | null>;
  set(key: string, state: SessionState): Promise<void>;
}

export interface SessionizerOptions {
  gapMs?: number;
  newId?: () => string;
}

export class Sessionizer {
  private readonly gapMs: number;
  private readonly newId: () => string;
  constructor(
    private readonly store: SessionStore,
    opts: SessionizerOptions = {},
  ) {
    this.gapMs = opts.gapMs ?? DEFAULT_GAP_MS;
    this.newId = opts.newId ?? randomUUID;
  }

  /** Assign (and persist) the sessionId for a distinctId at event time `tsMs`. */
  async assign(projectId: string, distinctId: string, tsMs: number): Promise<string> {
    const key = `${projectId}:${distinctId}`;
    const prev = await this.store.get(key);
    const sessionId = !prev || tsMs - prev.lastSeenMs > this.gapMs ? this.newId() : prev.sessionId;
    await this.store.set(key, { sessionId, lastSeenMs: Math.max(tsMs, prev?.lastSeenMs ?? tsMs) });
    return sessionId;
  }

  /** Stamp $session_id + $session_v onto an event. */
  async stamp(event: QueuedEvent): Promise<QueuedEvent> {
    const sessionId = await this.assign(event.projectId, event.distinctId, new Date(event.ts).getTime());
    return { ...event, props: { ...event.props, $session_id: sessionId, $session_v: SESSION_DEF_VERSION } };
  }
}

/** The slice of a Redis client the session store needs (ioredis satisfies it). Sessions are EPHEMERAL state —
 *  Redis with a TTL — while events are DURABLE in ClickHouse (the durable/ephemeral split, data-sized). */
export interface RedisKV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttlSec: number): Promise<unknown>;
}

export class RedisSessionStore implements SessionStore {
  constructor(
    private readonly redis: RedisKV,
    private readonly ttlSec = 3600,
  ) {}
  async get(key: string): Promise<SessionState | null> {
    const v = await this.redis.get(`sess:${key}`);
    return v ? (JSON.parse(v) as SessionState) : null;
  }
  async set(key: string, state: SessionState): Promise<void> {
    await this.redis.set(`sess:${key}`, JSON.stringify(state), "EX", this.ttlSec);
  }
}

export class InMemorySessionStore implements SessionStore {
  private readonly map = new Map<string, SessionState>();
  get(key: string): Promise<SessionState | null> {
    return Promise.resolve(this.map.get(key) ?? null);
  }
  set(key: string, state: SessionState): Promise<void> {
    this.map.set(key, state);
    return Promise.resolve();
  }
}
