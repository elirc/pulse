/**
 * The production KeyStore (S02): the Prisma-backed adapter behind @pulse/auth's CachedKeyResolver port. Lifted
 * into @pulse/db so BOTH deployables share one implementation — ingest resolves write keys on the hot path,
 * and the app API resolves keys for the management surface. The resolver caches on top of this, so these
 * queries run only on a cache MISS; `touchLastUsed` fires only on the resolver's ~1% sample.
 *
 * Tests inject an InMemoryKeyStore (from @pulse/auth) instead of this — how CI resolves keys with no database.
 */
import { prisma } from "./index";
import type { KeyStore, ResolvedKey } from "@pulse/auth";

type Db = typeof prisma;

export class PrismaKeyStore implements KeyStore {
  constructor(private readonly db: Db = prisma) {}

  async findByHash(hash: string): Promise<ResolvedKey | null> {
    const row = await this.db.apiKey.findUnique({
      where: { hash },
      select: { id: true, projectId: true, type: true, revokedAt: true },
    });
    if (!row) return null;
    return { id: row.id, projectId: row.projectId, type: row.type, revokedAt: row.revokedAt };
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.db.apiKey.update({ where: { id }, data: { lastUsedAt: new Date() } });
  }
}
