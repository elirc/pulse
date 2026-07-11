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
}
