import { randomInt } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

// Sans 0/O ni 1/I/L pour éviter les confusions quand on recopie un code.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function makeCode(username: string) {
  const base = username.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'MANDRIX';
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return `${base}-${suffix}`;
}

export const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, '');

/** Renvoie le code de parrainage du membre, en le créant au besoin. */
export async function ensureInviteCode(userId: string, username: string): Promise<string> {
  const [u] = await db.select({ code: schema.users.inviteCode }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (u?.code) return u.code;
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = makeCode(username);
    const updated = await db
      .update(schema.users)
      .set({ inviteCode: code })
      .where(sql`${schema.users.id} = ${userId} and ${schema.users.inviteCode} is null
        and not exists (select 1 from users u2 where u2.invite_code = ${code})`)
      .returning({ code: schema.users.inviteCode });
    if (updated[0]?.code) return updated[0].code;
    const [again] = await db.select({ code: schema.users.inviteCode }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (again?.code) return again.code;
  }
  throw new Error('Impossible de générer un code de parrainage');
}

/** Parrain d'un code : seulement un membre autorisé à parrainer et non suspendu. */
export async function findSponsor(code: string) {
  const [u] = await db
    .select({ id: schema.users.id, displayName: schema.users.displayName, username: schema.users.username })
    .from(schema.users)
    .where(and(eq(schema.users.inviteCode, normalizeCode(code)), eq(schema.users.canInvite, true), isNull(schema.users.suspendedAt)))
    .limit(1);
  return u ?? null;
}

export async function userCount() {
  const [r] = await db.execute<{ n: number }>(sql`select count(*)::int as n from users`);
  return r?.n ?? 0;
}
