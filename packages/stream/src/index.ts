/**
 * @pulse/stream — an event-stream port (Redis Streams / Kafka concepts) with an in-memory model for tests and a
 * Redis adapter for production. Dependency-free; see ADR-0005 for the Streams↔Kafka concept map.
 */
export * from "./types";
export { InMemoryEventStream } from "./memory";
export { RedisEventStream, type RedisLike } from "./redis";
