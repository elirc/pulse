import { PrismaClient } from "@prisma/client";

/** One PrismaClient per process; stashed on globalThis in dev so `tsx watch` reloads don't leak pools. */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export { Prisma, ApiKeyType } from "@prisma/client";
export type { Event, Org, User, Membership, Project, ApiKey } from "@prisma/client";
export { PrismaKeyStore } from "./keystore";
