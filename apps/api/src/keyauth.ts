/**
 * API-key authentication for the management API (S02). A server integration presents a key as
 * `Authorization: Bearer <key>`; we resolve it to a project. Distinct from session auth (auth.ts): a key is a
 * MACHINE credential.
 *
 * NOTE (S02, in-PR arc): resolving a key proves it is *valid*. It does NOT prove the key is *allowed* to do
 * what the route does. That distinction is the whole point of the privilege-confusion arc — see the read
 * endpoint and its capability fix in this same PR.
 */
import type { FastifyRequest } from "fastify";
import type { CachedKeyResolver, ResolvedKey } from "@pulse/auth";

export function presentedKey(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) return auth.slice("Bearer ".length);
  return null;
}

/** Resolve the presented key to its project/type, or null if absent/unknown/revoked. */
export async function resolveKey(req: FastifyRequest, resolver: CachedKeyResolver): Promise<ResolvedKey | null> {
  const key = presentedKey(req);
  if (!key) return null;
  return resolver.resolve(key);
}
