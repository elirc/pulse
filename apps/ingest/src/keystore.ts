/**
 * The production KeyStore (S02): the Prisma-backed adapter behind @pulse/auth's CachedKeyResolver port. The
 * resolver caches on top of this, so these queries run only on a cache MISS — not per event. `touchLastUsed`
 * is called only on the resolver's ~1% sample, so this UPDATE is rare by construction.
 *
 * Tests inject an InMemoryKeyStore instead of this, which is how CI resolves keys without a database.
 */
import { prisma } from "@pulse/db";
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
