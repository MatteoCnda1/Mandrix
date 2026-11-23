import { extractMentions } from '@mandrix/shared';
import { inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { AuthUser } from './auth.js';
import { notify } from './notify.js';
import { friendIds } from './users.js';

/** Prévient les amis mentionnés (@pseudo) dans un post ou un commentaire. */
export async function notifyMentions(author: AuthUser, text: string, target: { postId: string; kind: string; where: 'post' | 'comment'; id: string }) {
  const names = extractMentions(text).filter((u) => u !== author.username);
  if (names.length === 0) return;
  const rows = await db.select({ id: schema.users.id }).from(schema.users).where(inArray(schema.users.username, names));
  const friends = new Set(await friendIds(author.id));
  for (const u of rows) {
    if (!friends.has(u.id)) continue;
    await notify({
      userId: u.id,
      type: 'mention',
      actorId: author.id,
      data: { postId: target.postId, kind: target.kind, where: target.where, text: text.slice(0, 80) },
      dedupeKey: `mention:${target.where}:${target.id}`,
      push: { title: author.displayName, body: `t’a mentionné·e : ${text.slice(0, 100)}`, url: `/p/${target.postId}`, tag: `mention:${target.postId}` },
    });
  }
}
