/**
 * Redis-backed EventStream (S04) — the production implementation. It is typechecked and reviewed but not run in
 * CI (CI is Redis-less); its behavior is pinned by the in-memory model's tests plus a local/lab run. The point
 * of this file is to show the ACTUAL Redis Streams commands behind the port's methods.
 *
 * We depend on a structural `RedisLike` rather than importing a client, so the package stays dependency-free.
 * In production you pass an ioredis client (it satisfies these calls); the payload rides as a single JSON field.
 */
import type { EventStream, StreamEntry } from "./types";

/** The slice of a Redis client this adapter uses. An ioredis instance satisfies it. */
export interface RedisLike {
  xadd(key: string, id: string, field: string, value: string): Promise<string | null>;
  xlen(key: string): Promise<number>;
  xgroup(sub: "CREATE", key: string, group: string, start: string, mkstream: "MKSTREAM"): Promise<unknown>;
  // XREADGROUP GROUP <g> <consumer> COUNT <n> STREAMS <key> <id>
  xreadgroup(...args: (string | number)[]): Promise<RedisReadReply | null>;
  xack(key: string, group: string, ...ids: string[]): Promise<number>;
  xpending(key: string, group: string): Promise<[number, ...unknown[]]>;
}

/** XREADGROUP reply shape: [ [streamKey, [ [id, [field, value, ...]], ... ]] ]. */
type RedisReadReply = Array<[string, Array<[string, string[]]>]>;

const FIELD = "d"; // the single field holding the JSON payload

export class RedisEventStream<T> implements EventStream<T> {
  constructor(
    private readonly redis: RedisLike,
    private readonly key: string,
    private readonly consumerName: string,
  ) {}

  async add(data: T): Promise<string> {
    const id = await this.redis.xadd(this.key, "*", FIELD, JSON.stringify(data));
    return id ?? "";
  }

  depth(): Promise<number> {
    return this.redis.xlen(this.key); // XLEN — total entries; trim policy (MAXLEN) is an ops concern
  }

  async ensureGroup(group: string): Promise<void> {
    try {
      await this.redis.xgroup("CREATE", this.key, group, "$", "MKSTREAM");
    } catch {
      // BUSYGROUP: the group already exists — idempotent create, ignore.
    }
  }

  readNew(group: string, count: number): Promise<StreamEntry<T>[]> {
    return this.read(group, count, ">");
  }

  readPending(group: string, count: number): Promise<StreamEntry<T>[]> {
    return this.read(group, count, "0");
  }

  private async read(group: string, count: number, id: string): Promise<StreamEntry<T>[]> {
    const reply = await this.redis.xreadgroup(
      "GROUP",
      group,
      this.consumerName,
      "COUNT",
      count,
      "STREAMS",
      this.key,
      id,
    );
    if (!reply) return [];
    const entries = reply[0]?.[1] ?? [];
    return entries.map(([entryId, fields]) => ({ id: entryId, data: JSON.parse(fields[1]) as T }));
  }

  async ack(group: string, ids: string[]): Promise<void> {
    if (ids.length > 0) await this.redis.xack(this.key, group, ...ids);
  }

  async pending(group: string): Promise<number> {
    const reply = await this.redis.xpending(this.key, group);
    return reply[0] ?? 0;
  }
}
