import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db, schema } from '../db/index.js';
import { fail } from './http.js';

export const SESSION_COOKIE = 'mdx_session';
const SESSION_DAYS = 90;

export type AuthUser = typeof schema.users.$inferSelect;

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

export const hashPassword = (pw: string) => hash(pw, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (h: string, pw: string) => verify(h, pw).catch(() => false);

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');

export async function createSession(reply: FastifyReply, userId: string, userAgent?: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.insert(schema.sessions).values({ id: sha256(token), userId, expiresAt, userAgent: userAgent?.slice(0, 300) ?? null, lastSeenAt: new Date() });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function userFromToken(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  const rows = await db
    .select({ user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, sha256(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  const user = rows[0]?.user ?? null;
  return user && !user.suspendedAt ? user : null;
}

export function parseCookieHeader(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

// Dernière activité de chaque session, enregistrée au plus toutes les 10 minutes.
const seen = new Map<string, number>();

export async function authHook(req: FastifyRequest) {
  const token = req.cookies[SESSION_COOKIE];
  req.user = await userFromToken(token);
  if (req.user && token) {
    const id = sha256(token);
    const now = Date.now();
    if (now - (seen.get(id) ?? 0) > 10 * 60_000) {
      seen.set(id, now);
      if (seen.size > 5000) seen.clear();
      await db.update(schema.sessions).set({ lastSeenAt: new Date(now) }).where(eq(schema.sessions.id, id));
    }
  }
}

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) fail(401, 'Connecte-toi pour continuer');
  return req.user!;
}
