import { extractMentions } from '@mandrix/shared';
import { inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { AuthUser } from './auth.js';
import { notify } from './notify.js';
import { friendIds } from './users.js';

/**
 * Prévient les amis mentionnés (@pseudo) dans un post ou un commentaire.
 * `anonymous` : texte signé « Anonyme » (post anonyme, ou son auteur qui le commente) ; le post étant
 * visible de tous, toute personne mentionnée est prévenue, sans auteur dans la notification ni le push.
 */
export async function notifyMentions(
  author: AuthUser,
  text: string,
  target: { postId: string; kind: string; where: 'post' | 'comment'; id: string; postAuthorId?: string; anonymous?: boolean },
) {
  const names = extractMentions(text).filter((u) => u !== author.username);
  if (names.length === 0) return;
  const rows = await db.select({ id: schema.users.id }).from(schema.users).where(inArray(schema.users.username, names));
  const friends = target.anonymous ? null : new Set(await friendIds(author.id));
  // Dans un commentaire : seulement les personnes qui voient le post (l'auteur du post et ses amis).
  const audience = target.postAuthorId && target.postAuthorId !== author.id ? new Set([target.postAuthorId, ...(await friendIds(target.postAuthorId))]) : null;
  for (const u of rows) {
    if (u.id === author.id) continue;
    if ((friends && !friends.has(u.id)) || (audience && !audience.has(u.id))) continue;
    await notify({
      userId: u.id,
      type: 'mention',
      actorId: target.anonymous ? null : author.id,
      data: { postId: target.postId, kind: target.kind, where: target.where, text: text.slice(0, 80), ...(target.anonymous ? { anonymous: true } : {}) },
      dedupeKey: `mention:${target.where}:${target.id}`,
      push: {
        title: target.anonymous ? 'Anonyme' : author.displayName,
        body: `t’a mentionné·e : ${text.slice(0, 100)}`,
        url: `/p/${target.postId}`,
        tag: `mention:${target.postId}`,
      },
    });
  }
}
