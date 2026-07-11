/**
 * Request authentication for the management API (S02). Two credential kinds reach these routes, and they are
 * NOT interchangeable:
 *   • a session (a human in the web app)   → this file
 *   • a secret API key (a server integration) → keyauth.ts, added with the capability guard
 *
 * Issuing keys is a human action, so it requires a session. The distinction is the whole lesson of the sprint:
 * who holds a credential determines what it may do.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { verifySession, type Session } from "@pulse/auth";
import { env } from "./env";

declare module "fastify" {
  interface FastifyRequest {
    session?: Session;
  }
}

/** Read + verify a Bearer session token, or null. */
export function readSession(req: FastifyRequest): Session | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return verifySession(header.slice("Bearer ".length), env.SESSION_SECRET);
}

/** preHandler: 401 unless a valid session is present; attaches it to `req.session`. */
export async function requireSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const session = readSession(req);
  if (!session) {
    await reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Session required" } });
    return;
  }
  req.session = session;
}
