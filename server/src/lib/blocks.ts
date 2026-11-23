import { and, eq, or } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

const { blocks } = schema;

/** Vrai si l'un des deux a bloqué l'autre. */
export async function isBlockedBetween(a: string, b: string) {
  const rows = await db
    .select({ x: blocks.blockerId })
    .from(blocks)
    .where(or(and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)), and(eq(blocks.blockerId, b), eq(blocks.blockedId, a))))
    .limit(1);
  return rows.length > 0;
}

/** Personnes bloquées par moi ou qui m'ont bloqué. */
export async function blockedIds(userId: string) {
  const rows = await db
    .select()
    .from(blocks)
    .where(or(eq(blocks.blockerId, userId), eq(blocks.blockedId, userId)));
  return new Set(rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId)));
}
