import { describe, it, expect, afterAll } from "vitest";
import { CachedKeyResolver, InMemoryKeyStore, generateApiKey } from "@pulse/auth";
import { InMemoryEventStream } from "@pulse/stream";
import type { QueuedEvent } from "@pulse/shared";
import { buildIngestServer } from "./server";

const store = new InMemoryKeyStore();
const writeKey = generateApiKey("WRITE");
store.add(writeKey.hash, { id: "k1", projectId: "proj1", type: "WRITE", revokedAt: null });
const resolver = new CachedKeyResolver(store, { rng: () => 1 });
const stream = new InMemoryEventStream<QueuedEvent>();
const app = buildIngestServer({ resolver, stream });
const authed = { authorization: `Bearer ${writeKey.plaintext}` };

afterAll(async () => {
  await app.close();
});

describe("ingest PII scrubbing (S13)", () => {
  it("drops denied props and hashes contact props before they hit the stream", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/e",
      headers: authed,
      payload: { name: "signup", distinctId: "u1", props: { password: "hunter2", email: "a@b.com", plan: "pro" } },
    });
    expect(res.statusCode).toBe(202);

    await stream.ensureGroup("t");
    const [entry] = await stream.readNew("t", 1);
    const props = entry.data.props as Record<string, unknown>;
    expect(props.password).toBeUndefined(); // denied → never stored
    expect(props.plan).toBe("pro"); // untouched
    expect(typeof props.email).toBe("string");
    expect(props.email).not.toBe("a@b.com"); // pseudonymized
    expect(props.email).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
  });
});
