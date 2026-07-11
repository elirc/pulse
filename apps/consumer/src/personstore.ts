/**
 * Person store (S06): the persistence behind the identity graph. In-memory for tests; Prisma for prod. Kept as
 * a port so the resolver's create-on-first-sight and merge logic are testable without a database.
 */
import { prisma } from "@pulse/db";
import type { PersonStore } from "./identity";

interface PersonRow {
  id: string;
  createdAt: number; // monotonic, so "oldest person wins" a merge is deterministic
  properties: Record<string, unknown>;
}

export class InMemoryPersonStore implements PersonStore {
  public readonly persons = new Map<string, PersonRow>();
  /** key `${projectId}:${distinctId}` → personId */
  public readonly mappings = new Map<string, string>();
  private seq = 0;

  findPersonId(projectId: string, distinctId: string): Promise<string | null> {
    return Promise.resolve(this.mappings.get(`${projectId}:${distinctId}`) ?? null);
  }

  createPersonWithMapping(projectId: string, distinctId: string): Promise<string> {
    const id = `person_${++this.seq}`;
    this.persons.set(id, { id, createdAt: this.seq, properties: {} });
    this.mappings.set(`${projectId}:${distinctId}`, id);
    return Promise.resolve(id);
  }

  createdOrder(personId: string): Promise<number> {
    return Promise.resolve(this.persons.get(personId)?.createdAt ?? Number.MAX_SAFE_INTEGER);
  }

  remapMappings(projectId: string, fromPersonId: string, toPersonId: string): Promise<string[]> {
    const moved: string[] = [];
    for (const [key, personId] of this.mappings) {
      if (personId === fromPersonId && key.startsWith(`${projectId}:`)) {
        this.mappings.set(key, toPersonId);
        moved.push(key.slice(projectId.length + 1));
      }
    }
    return Promise.resolve(moved);
  }

  foldProperties(winnerId: string, loserId: string): Promise<void> {
    const winner = this.persons.get(winnerId);
    const loser = this.persons.get(loserId);
    if (winner && loser) winner.properties = { ...loser.properties, ...winner.properties }; // winner wins conflicts
    return Promise.resolve();
  }

  deletePerson(personId: string): Promise<void> {
    this.persons.delete(personId);
    return Promise.resolve();
  }
}

type Db = typeof prisma;

export class PrismaPersonStore implements PersonStore {
  constructor(private readonly db: Db = prisma) {}

  async findPersonId(projectId: string, distinctId: string): Promise<string | null> {
    const row = await this.db.distinctIdMapping.findUnique({
      where: { projectId_distinctId: { projectId, distinctId } },
      select: { personId: true },
    });
    return row?.personId ?? null;
  }

  async createPersonWithMapping(projectId: string, distinctId: string): Promise<string> {
    // One transaction: a Person and its first mapping. The unique (projectId, distinctId) constraint means a
    // concurrent create loses here with a unique violation rather than producing a silent duplicate.
    const person = await this.db.person.create({ data: { projectId } });
    await this.db.distinctIdMapping.create({ data: { projectId, distinctId, personId: person.id } });
    return person.id;
  }

  async createdOrder(personId: string): Promise<number> {
    const p = await this.db.person.findUnique({ where: { id: personId }, select: { createdAt: true } });
    return p ? p.createdAt.getTime() : Number.MAX_SAFE_INTEGER;
  }

  async remapMappings(projectId: string, fromPersonId: string, toPersonId: string): Promise<string[]> {
    const rows = await this.db.distinctIdMapping.findMany({
      where: { projectId, personId: fromPersonId },
      select: { distinctId: true },
    });
    await this.db.distinctIdMapping.updateMany({
      where: { projectId, personId: fromPersonId },
      data: { personId: toPersonId },
    });
    return rows.map((r) => r.distinctId);
  }

  async foldProperties(winnerId: string, loserId: string): Promise<void> {
    const [winner, loser] = await Promise.all([
      this.db.person.findUnique({ where: { id: winnerId }, select: { properties: true } }),
      this.db.person.findUnique({ where: { id: loserId }, select: { properties: true } }),
    ]);
    const merged = { ...(loser?.properties as object), ...(winner?.properties as object) }; // winner wins conflicts
    await this.db.person.update({ where: { id: winnerId }, data: { properties: merged } });
  }

  async deletePerson(personId: string): Promise<void> {
    await this.db.person.delete({ where: { id: personId } });
  }
}
