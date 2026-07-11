import { describe, it, expect } from "vitest";
import { generateApiKey } from "./keys";
import { CachedKeyResolver, InMemoryKeyStore, shouldSample, type ResolvedKey } from "./resolver";

function seed(store: InMemoryKeyStore, over: Partial<ResolvedKey> = {}): string {
  const k = generateApiKey("WRITE");
  store.add(k.hash, { id: "key1", projectId: "proj1", type: "WRITE", revokedAt: null, ...over });
  return k.plaintext;
}

describe("CachedKeyResolver (S02 hot path)", () => {
  it("resolves a known key to its project", async () => {
    const store = new InMemoryKeyStore();
    const plaintext = seed(store);
    const resolver = new CachedKeyResolver(store, { rng: () => 1 });
    expect(await resolver.resolve(plaintext)).toMatchObject({ projectId: "proj1", type: "WRITE" });
  });

  it("returns null for an unknown key", async () => {
    const resolver = new CachedKeyResolver(new InMemoryKeyStore(), { rng: () => 1 });
    expect(await resolver.resolve("pw_live_unknown")).toBeNull();
  });

  it("caches within the TTL — a second resolve does not hit the store", async () => {
    const store = new InMemoryKeyStore();
    const plaintext = seed(store);
    let hits = 0;
    const orig = store.findByHash.bind(store);
    store.findByHash = (h) => {
      hits++;
      return orig(h);
    };
    const resolver = new CachedKeyResolver(store, { ttlMs: 1000, now: () => 0, rng: () => 1 });
    await resolver.resolve(plaintext);
    await resolver.resolve(plaintext);
    expect(hits).toBe(1);
  });

  it("re-hits the store after the TTL expires", async () => {
    const store = new InMemoryKeyStore();
    const plaintext = seed(store);
    let hits = 0;
    const orig = store.findByHash.bind(store);
    store.findByHash = (h) => {
      hits++;
      return orig(h);
    };
    let clock = 0;
    const resolver = new CachedKeyResolver(store, { ttlMs: 1000, now: () => clock, rng: () => 1 });
    await resolver.resolve(plaintext);
    clock = 2000;
    await resolver.resolve(plaintext);
    expect(hits).toBe(2);
  });

  it("rejects a revoked key on a cache miss", async () => {
    const store = new InMemoryKeyStore();
    const plaintext = seed(store, { revokedAt: new Date() });
    const resolver = new CachedKeyResolver(store, { rng: () => 1 });
    expect(await resolver.resolve(plaintext)).toBeNull();
  });

  it("documented 'undead key' window: a key cached while valid keeps resolving until TTL", async () => {
    const store = new InMemoryKeyStore();
    const plaintext = seed(store);
    let clock = 0;
    const resolver = new CachedKeyResolver(store, { ttlMs: 60_000, now: () => clock, rng: () => 1 });
    expect(await resolver.resolve(plaintext)).not.toBeNull(); // cached while valid
    store.findByHash = () => Promise.resolve(null); // revoked at the store the instant after
    clock = 30_000; // within TTL
    expect(await resolver.resolve(plaintext)).not.toBeNull(); // still undead — the accepted lag
    clock = 61_000; // past TTL
    expect(await resolver.resolve(plaintext)).toBeNull(); // now gone
  });

  it("samples lastUsedAt rather than writing every resolve", async () => {
    const store = new InMemoryKeyStore();
    const plaintext = seed(store);
    // rng always below the sample rate → always writes
    const hot = new CachedKeyResolver(store, { rng: () => 0, sampleRate: 0.01, ttlMs: 0, now: () => Date.now() });
    await hot.resolve(plaintext);
    expect(store.touches).toEqual(["key1"]);
    // rng always above the rate → never writes
    store.touches = [];
    const cold = new CachedKeyResolver(store, { rng: () => 0.5, sampleRate: 0.01, ttlMs: 0 });
    await cold.resolve(plaintext);
    expect(store.touches).toEqual([]);
  });

  it("shouldSample is a pure threshold on rng", () => {
    expect(shouldSample(() => 0.005, 0.01)).toBe(true);
    expect(shouldSample(() => 0.02, 0.01)).toBe(false);
  });
});
