import {
  attachmentLabel,
  GROUP_MAX_MEMBERS,
  MESSAGE_REACTIONS,
  type Conversation,
  type ConversationDetail,
  type MediaRef,
  type Message,
  type MessageMeta,
  type MessageReaction,
} from '@mandrix/shared';
import { and, asc, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireUser, type AuthUser } from '../lib/auth.js';
import { fail, parse, uuidParam } from '../lib/http.js';
import { mediaRef } from '../lib/media.js';
import { emitBadges, notify } from '../lib/notify.js';
import { sendPush } from '../lib/push.js';
import { isBlockedBetween } from '../lib/blocks.js';
import { areFriends, friendIds, usersByIds } from '../lib/users.js';
import { emitToUser } from '../realtime/io.js';
import { presenceOf } from '../realtime/presence.js';
import { perMinute } from '../lib/limits.js';

const { conversations, conversationMembers, messages, conversationReads, messageReactions } = schema;

type MessageRow = typeof messages.$inferSelect;

/** Pièces jointes des messages, lues à jour (une vidéo peut finir son transcodage après l'envoi). */
async function attachments(rows: MessageRow[]) {
  const ids = [...new Set(rows.map((r) => r.mediaId).filter((x): x is string => !!x))];
  const map = new Map<string, MediaRef>();
  if (ids.length === 0) return map;
  const media = await db.select().from(schema.media).where(inArray(schema.media.id, ids));
  for (const m of media) map.set(m.id, mediaRef(m)!);
  return map;
}

/** Réactions groupées par emoji, dans l'ordre d'arrivée. */
async function reactionsOf(ids: string[]) {
  const map = new Map<string, MessageReaction[]>();
  if (ids.length === 0) return map;
  const rows = await db.select().from(messageReactions).where(inArray(messageReactions.messageId, ids)).orderBy(asc(messageReactions.createdAt));
  for (const r of rows) {
    const list = map.get(r.messageId) ?? [];
    let entry = list.find((x) => x.emoji === r.emoji);
    if (!entry) list.push((entry = { emoji: r.emoji, userIds: [] }));
    entry.userIds.push(r.userId);
    map.set(r.messageId, list);
  }
  return map;
}

async function toMessages(rows: MessageRow[]): Promise<Message[]> {
  const media = await attachments(rows);
  const reactions = await reactionsOf(rows.map((r) => r.id));
  return rows.map((m) => {
    const deleted = !!m.deletedAt;
    return {
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      text: deleted ? '' : m.text,
      meta: deleted ? null : ((m.meta as MessageMeta) ?? null),
      media: !deleted && m.mediaId ? (media.get(m.mediaId) ?? null) : null,
      reactions: deleted ? [] : (reactions.get(m.id) ?? []),
      deleted,
      createdAt: m.createdAt.toISOString(),
    };
  });
}

async function memberIds(conversationId: string) {
  const rows = await db
    .select({ id: conversationMembers.userId })
    .from(conversationMembers)
    .where(eq(conversationMembers.conversationId, conversationId));
  return rows.map((r) => r.id);
}

export async function getOrCreateConversation(a: string, b: string) {
  const [userA, userB] = a < b ? [a, b] : [b, a];
  let [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.userA, userA), eq(conversations.userB, userB)))
    .limit(1);
  if (!conv) {
    [conv] = await db.insert(conversations).values({ userA, userB }).onConflictDoNothing().returning();
    if (!conv) [conv] = await db.select().from(conversations).where(and(eq(conversations.userA, userA), eq(conversations.userB, userB)));
  }
  await db
    .insert(conversationMembers)
    .values([
      { conversationId: conv.id, userId: userA },
      { conversationId: conv.id, userId: userB },
    ])
    .onConflictDoNothing();
  return conv;
}

/** Marque la conversation comme lue et prévient les autres membres (accusé « Vu »). */
async function markRead(conversationId: string, userId: string, announce = true) {
  const now = new Date();
  await db
    .insert(conversationReads)
    .values({ conversationId, userId, lastReadAt: now })
    .onConflictDoUpdate({ target: [conversationReads.conversationId, conversationReads.userId], set: { lastReadAt: now } });
  if (!announce) return;
  for (const uid of await memberIds(conversationId)) {
    if (uid !== userId) emitToUser(uid, 'dm:read', { conversationId, userId, at: now.toISOString() });
  }
}

// « En train d'écrire » : relayé aux autres membres, sans passer par la base à chaque frappe.
const membersCache = new Map<string, { ids: string[]; at: number }>();

export async function relayTyping(userId: string, conversationId: string, typing: boolean) {
  if (typeof conversationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(conversationId)) return;
  let cached = membersCache.get(conversationId);
  if (!cached || Date.now() - cached.at > 30_000) {
    cached = { ids: await memberIds(conversationId), at: Date.now() };
    membersCache.set(conversationId, cached);
    if (membersCache.size > 2000) membersCache.clear();
  }
  if (!cached.ids.includes(userId)) return;
  for (const uid of cached.ids) if (uid !== userId) emitToUser(uid, 'dm:typing', { conversationId, userId, typing: !!typing });
}

/** Publie un message dans une conversation et prévient tous ses membres. */
async function postMessage(conv: typeof conversations.$inferSelect, from: AuthUser, text: string, meta: MessageMeta = null, mediaId: string | null = null) {
  const [m] = await db.insert(messages).values({ conversationId: conv.id, senderId: from.id, text, meta, mediaId }).returning();
  await db.update(conversations).set({ lastMessageAt: m.createdAt }).where(eq(conversations.id, conv.id));
  await markRead(conv.id, from.id, false);
  const [msg] = await toMessages([m]);
  const members = await memberIds(conv.id);
  for (const uid of members) emitToUser(uid, 'dm:new', msg);
  const others = members.filter((id) => id !== from.id);
  for (const uid of others) await emitBadges(uid);
  const muted = new Set(
    (
      await db
        .select({ id: conversationMembers.userId })
        .from(conversationMembers)
        .where(and(eq(conversationMembers.conversationId, conv.id), eq(conversationMembers.muted, true)))
    ).map((r) => r.id),
  );
  const audible = others.filter((id) => !muted.has(id));
  if (meta?.type !== 'system' && audible.length) {
    const title = conv.isGroup ? (conv.title ?? 'Groupe') : from.displayName;
    const content = text || attachmentLabel(msg.media?.kind, msg.media?.duration);
    const body = conv.isGroup ? `${from.displayName} : ${content}` : content;
    sendPush(audible, { title, body: body.slice(0, 140), url: `/messages/${conv.id}`, tag: `dm:${conv.id}` }, 'message').catch(() => {});
  }
  return msg;
}

export async function sendDm(from: AuthUser, toUserId: string, text: string, meta: MessageMeta = null) {
  if (!(await areFriends(from.id, toUserId))) fail(403, 'Tu ne peux écrire qu’à tes amis');
  const conv = await getOrCreateConversation(from.id, toUserId);
  return postMessage(conv, from, text, meta);
}

/** Message d'une conversation dont je suis membre (hors messages système). */
async function reactable(messageId: string, userId: string) {
  const [m] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!m || m.deletedAt || (m.meta as MessageMeta)?.type === 'system') fail(404, 'Message introuvable');
  await ownConversation(m!.conversationId, userId);
  return m!;
}

async function broadcastReactions(m: MessageRow) {
  const reactions = (await reactionsOf([m.id])).get(m.id) ?? [];
  for (const uid of await memberIds(m.conversationId)) {
    emitToUser(uid, 'dm:reaction', { conversationId: m.conversationId, messageId: m.id, reactions });
  }
  return reactions;
}

async function ownConversation(id: string, userId: string) {
  const [row] = await db
    .select({ conv: conversations })
    .from(conversations)
    .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, conversations.id), eq(conversationMembers.userId, userId)))
    .where(eq(conversations.id, id))
    .limit(1);
  if (!row) fail(404, 'Conversation introuvable');
  return row!.conv;
}

async function detail(conv: typeof conversations.$inferSelect, meId: string): Promise<ConversationDetail> {
  const ids = await memberIds(conv.id);
  const users = await usersByIds(ids);
  const members = ids.map((id) => users.get(id)!).filter(Boolean);
  members.sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : a.displayName.localeCompare(b.displayName, 'fr')));
  const other = conv.isGroup ? null : (members.find((m) => m.id !== meId) ?? null);
  const reads = await db
    .select({ userId: conversationReads.userId, at: conversationReads.lastReadAt })
    .from(conversationReads)
    .where(and(eq(conversationReads.conversationId, conv.id), ne(conversationReads.userId, meId)));
  const [viewer] = await db.select({ id: schema.users.id, showPresence: schema.users.showPresence }).from(schema.users).where(eq(schema.users.id, meId)).limit(1);
  const presence = other && viewer ? ((await presenceOf(viewer, [other.id])).get(other.id) ?? null) : null;
  const [mine] = await db
    .select({ muted: conversationMembers.muted })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conv.id), eq(conversationMembers.userId, meId)))
    .limit(1);
  return {
    id: conv.id,
    isGroup: conv.isGroup,
    title: conv.title,
    user: other,
    members,
    createdBy: conv.createdBy,
    reads: reads.map((r) => ({ userId: r.userId, at: r.at.toISOString() })),
    muted: !!mine?.muted,
    presence,
  };
}

/** Vérifie que tous les utilisateurs sont amis avec `me`. */
async function onlyFriends(meId: string, ids: string[]) {
  const friends = new Set(await friendIds(meId));
  const bad = ids.filter((id) => !friends.has(id));
  if (bad.length) fail(403, 'Tu ne peux ajouter que tes amis');
}

/** Messages chargés par page (ouverture, puis en remontant). */
export const HISTORY_PAGE = 100;

const textSchema = z.object({ text: z.string().trim().min(1, 'Message vide').max(1000) });
const titleSchema = z.string().trim().max(40, 'Nom du groupe : 40 caractères max');
const firstName = (name: string) => name.split(' ')[0];

export default async function messageRoutes(app: FastifyInstance) {
  app.get('/api/conversations', async (req): Promise<Conversation[]> => {
    const me = requireUser(req);
    const rows = await db.execute<{
      id: string;
      isGroup: boolean;
      title: string | null;
      members: string[];
      text: string | null;
      at: Date | null;
      senderId: string | null;
      meta: { type?: string } | null;
      mediaKind: 'image' | 'video' | 'audio' | null;
      mediaDuration: number | null;
      deleted: boolean;
      muted: boolean;
      unread: boolean;
    }>(sql`
      select c.id, c.is_group as "isGroup", c.title,
        array(select cm.user_id from conversation_members cm where cm.conversation_id = c.id and cm.user_id <> ${me.id} order by cm.created_at) as members,
        lm.text, lm.created_at as at, lm.sender_id as "senderId", lm.meta,
        lmm.kind as "mediaKind", lmm.duration as "mediaDuration", (lm.deleted_at is not null) as deleted, mine.muted,
        exists(
          select 1 from messages msg where msg.conversation_id = c.id and msg.sender_id <> ${me.id}
            and msg.created_at > coalesce((select r.last_read_at from conversation_reads r where r.conversation_id = c.id and r.user_id = ${me.id}), 'epoch'::timestamptz)
        ) as unread
      from conversations c
      join conversation_members mine on mine.conversation_id = c.id and mine.user_id = ${me.id}
      left join lateral (
        select m.text, m.created_at, m.sender_id, m.meta, m.media_id, m.deleted_at from messages m where m.conversation_id = c.id order by m.created_at desc limit 1
      ) lm on true
      left join media lmm on lmm.id = lm.media_id
      order by c.last_message_at desc limit 100`);
    const list = [...rows];
    const users = await usersByIds(list.flatMap((r) => [...r.members, r.senderId]));
    const presence = await presenceOf(me, list.filter((r) => !r.isGroup && r.members[0]).map((r) => r.members[0]));
    return list
      .filter((r) => r.isGroup || r.members.length > 0)
      .map((r) => {
        const members = r.members.map((id) => users.get(id)!).filter(Boolean);
        const sender = r.senderId ? users.get(r.senderId) : null;
        return {
          id: r.id,
          isGroup: r.isGroup,
          title: r.title,
          user: r.isGroup ? null : (members[0] ?? null),
          members,
          last: r.at
            ? {
                text: r.deleted ? 'Message supprimé' : r.text || attachmentLabel(r.mediaKind, r.mediaDuration),
                at: new Date(r.at).toISOString(),
                mine: r.senderId === me.id,
                sender: r.isGroup && sender && r.senderId !== me.id ? firstName(sender.displayName) : null,
                system: r.meta?.type === 'system',
              }
            : null,
          unread: r.unread,
          muted: r.muted,
          presence: r.isGroup ? null : (presence.get(r.members[0]) ?? null),
        };
      });
  });

  /** Conversation à deux (`userId`) ou groupe (`userIds` + `title`). */
  app.post('/api/conversations', perMinute(20), async (req) => {
    const me = requireUser(req);
    const body = parse(
      z.object({
        userId: z.string().uuid().optional(),
        userIds: z.array(z.string().uuid()).max(GROUP_MAX_MEMBERS - 1).optional(),
        title: titleSchema.optional(),
      }),
      req.body,
    );
    if (body.userId) {
      if (body.userId === me.id || !(await areFriends(me.id, body.userId))) fail(403, 'Tu ne peux écrire qu’à tes amis');
      const conv = await getOrCreateConversation(me.id, body.userId);
      return { id: conv.id };
    }
    const ids = [...new Set(body.userIds ?? [])].filter((id) => id !== me.id);
    if (ids.length < 2) fail(400, 'Choisis au moins deux amis pour créer un groupe');
    await onlyFriends(me.id, ids);
    const [conv] = await db.insert(conversations).values({ isGroup: true, title: body.title || null, createdBy: me.id }).returning();
    await db.insert(conversationMembers).values([me.id, ...ids].map((userId) => ({ conversationId: conv.id, userId })));
    await postMessage(conv, me, `${me.displayName} a créé le groupe${conv.title ? ` « ${conv.title} »` : ''}`, { type: 'system' });
    return { id: conv.id };
  });

  app.get('/api/conversations/:id', async (req): Promise<ConversationDetail> => {
    const me = requireUser(req);
    const conv = await ownConversation(uuidParam(req.params), me.id);
    return detail(conv, me.id);
  });

  app.patch('/api/conversations/:id', async (req): Promise<ConversationDetail> => {
    const me = requireUser(req);
    const conv = await ownConversation(uuidParam(req.params), me.id);
    if (!conv.isGroup) fail(400, 'Seuls les groupes ont un nom');
    const { title } = parse(z.object({ title: titleSchema }), req.body);
    const [updated] = await db.update(conversations).set({ title: title || null }).where(eq(conversations.id, conv.id)).returning();
    await postMessage(updated, me, title ? `${me.displayName} a renommé le groupe « ${title} »` : `${me.displayName} a retiré le nom du groupe`, { type: 'system' });
    return detail(updated, me.id);
  });

  app.post('/api/conversations/:id/members', async (req): Promise<ConversationDetail> => {
    const me = requireUser(req);
    const conv = await ownConversation(uuidParam(req.params), me.id);
    if (!conv.isGroup) fail(400, 'Crée un groupe pour ajouter des personnes');
    const { userIds } = parse(z.object({ userIds: z.array(z.string().uuid()).min(1).max(GROUP_MAX_MEMBERS) }), req.body);
    const current = new Set(await memberIds(conv.id));
    const toAdd = [...new Set(userIds)].filter((id) => !current.has(id));
    if (toAdd.length === 0) return detail(conv, me.id);
    if (current.size + toAdd.length > GROUP_MAX_MEMBERS) fail(400, `Un groupe compte ${GROUP_MAX_MEMBERS} membres maximum`);
    await onlyFriends(me.id, toAdd);
    await db
      .insert(conversationMembers)
      .values(toAdd.map((userId) => ({ conversationId: conv.id, userId })))
      .onConflictDoNothing();
    const added = await usersByIds(toAdd);
    const names = toAdd.map((id) => added.get(id)?.displayName).filter(Boolean).join(', ');
    await postMessage(conv, me, `${me.displayName} a ajouté ${names}`, { type: 'system' });
    return detail(conv, me.id);
  });

  /** Le créateur d'un groupe retire un membre. */
  app.delete('/api/conversations/:id/members/:userId', async (req): Promise<ConversationDetail> => {
    const me = requireUser(req);
    const { id, userId } = req.params as { id: string; userId: string };
    const conv = await ownConversation(uuidParam({ id }), me.id);
    if (!conv.isGroup) fail(400, 'Seuls les groupes ont des membres à retirer');
    if (conv.createdBy !== me.id) fail(403, 'Seul le créateur du groupe peut retirer quelqu’un');
    const target = uuidParam({ id: userId });
    if (target === me.id) fail(400, 'Utilise « Quitter le groupe »');
    if (!(await memberIds(conv.id)).includes(target)) fail(404, 'Cette personne n’est pas dans le groupe');
    const who = (await usersByIds([target])).get(target);
    // Le message part avant le retrait : la personne voit qu'elle a été retirée.
    await postMessage(conv, me, `${me.displayName} a retiré ${who?.displayName ?? 'un membre'}`, { type: 'system' });
    await db.delete(conversationMembers).where(and(eq(conversationMembers.conversationId, conv.id), eq(conversationMembers.userId, target)));
    await db.delete(conversationReads).where(and(eq(conversationReads.conversationId, conv.id), eq(conversationReads.userId, target)));
    membersCache.delete(conv.id);
    await emitBadges(target);
    return detail(conv, me.id);
  });

  app.post('/api/conversations/:id/leave', async (req) => {
    const me = requireUser(req);
    const conv = await ownConversation(uuidParam(req.params), me.id);
    if (!conv.isGroup) fail(400, 'On ne quitte pas une conversation à deux');
    await postMessage(conv, me, `${me.displayName} a quitté le groupe`, { type: 'system' });
    await db.delete(conversationMembers).where(and(eq(conversationMembers.conversationId, conv.id), eq(conversationMembers.userId, me.id)));
    await db.delete(conversationReads).where(and(eq(conversationReads.conversationId, conv.id), eq(conversationReads.userId, me.id)));
    // Plus personne : le groupe disparaît.
    if ((await memberIds(conv.id)).length === 0) await db.delete(conversations).where(eq(conversations.id, conv.id));
    await emitBadges(me.id);
    return { ok: true };
  });

  app.get('/api/conversations/:id/messages', async (req): Promise<Message[]> => {
    const me = requireUser(req);
    const c = await ownConversation(uuidParam(req.params), me.id);
    const before = String((req.query as { before?: string }).before ?? '');
    let older: Date | null = null;
    if (before) {
      const [ref] = await db
        .select({ at: messages.createdAt })
        .from(messages)
        .where(and(eq(messages.id, before), eq(messages.conversationId, c.id)))
        .limit(1);
      if (!ref) fail(400, 'Message de référence introuvable');
      older = ref!.at;
    }
    const rows = await db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, c.id), older ? lt(messages.createdAt, older) : undefined))
      .orderBy(desc(messages.createdAt))
      .limit(HISTORY_PAGE);
    // Ouvrir la conversation la marque comme lue ; remonter dans l'historique, non.
    if (!older) {
      await markRead(c.id, me.id);
      await emitBadges(me.id);
    }
    return toMessages(rows.reverse());
  });

  app.post('/api/conversations/:id/messages', perMinute(30), async (req) => {
    const me = requireUser(req);
    const c = await ownConversation(uuidParam(req.params), me.id);
    const body = parse(
      z
        .object({ text: z.string().trim().max(1000).default(''), mediaId: z.string().uuid().optional(), replyToId: z.string().uuid().optional() })
        .refine((b) => b.text.length > 0 || !!b.mediaId, { message: 'Message vide' }),
      req.body,
    );
    if (!c.isGroup) {
      const other = (await memberIds(c.id)).find((id) => id !== me.id);
      if (other && (await isBlockedBetween(me.id, other))) fail(403, 'Tu ne peux plus écrire à cette personne');
    }
    if (body.mediaId) {
      const [m] = await db.select({ ownerId: schema.media.ownerId }).from(schema.media).where(eq(schema.media.id, body.mediaId)).limit(1);
      if (!m || m.ownerId !== me.id) fail(400, 'Pièce jointe introuvable');
    }
    let meta: MessageMeta = null;
    if (body.replyToId) {
      // Citation figée au moment de la réponse : elle reste lisible même si l'original disparaît.
      const [orig] = await db
        .select({ m: messages, kind: schema.media.kind, duration: schema.media.duration })
        .from(messages)
        .leftJoin(schema.media, eq(schema.media.id, messages.mediaId))
        .where(and(eq(messages.id, body.replyToId), eq(messages.conversationId, c.id)))
        .limit(1);
      if (!orig || orig.m.deletedAt || (orig.m.meta as MessageMeta)?.type === 'system') fail(400, 'Message d’origine introuvable');
      const text = orig!.m.text || attachmentLabel(orig!.kind, orig!.duration);
      meta = { type: 'reply', replyTo: { id: orig!.m.id, senderId: orig!.m.senderId, text: text.length > 140 ? `${text.slice(0, 139)}…` : text } };
    }
    return postMessage(c, me, body.text, meta, body.mediaId ?? null);
  });

  app.post('/api/conversations/:id/read', async (req) => {
    const me = requireUser(req);
    const c = await ownConversation(uuidParam(req.params), me.id);
    await markRead(c.id, me.id);
    await emitBadges(me.id);
    return { ok: true };
  });

  /** Supprimer son message pour tout le monde : texte, pièce jointe et réactions effacés. */
  app.delete('/api/messages/:id', async (req) => {
    const me = requireUser(req);
    const m = await reactable(uuidParam(req.params), me.id);
    if (m.senderId !== me.id) fail(403, 'Tu ne peux supprimer que tes messages');
    const [updated] = await db
      .update(messages)
      .set({ deletedAt: new Date(), text: '', mediaId: null, meta: null })
      .where(eq(messages.id, m.id))
      .returning();
    await db.delete(messageReactions).where(eq(messageReactions.messageId, m.id));
    // Les réponses qui le citaient ne gardent plus son texte.
    const quoting = await db
      .update(messages)
      .set({ meta: sql`jsonb_set(${messages.meta}, '{replyTo,text}', '"Message supprimé"'::jsonb)` })
      .where(and(eq(messages.conversationId, m.conversationId), sql`${messages.meta}->>'type' = 'reply'`, sql`${messages.meta}->'replyTo'->>'id' = ${m.id}`))
      .returning();
    const changed = await toMessages([updated, ...quoting]);
    for (const uid of await memberIds(m.conversationId)) for (const x of changed) emitToUser(uid, 'dm:update', x);
    return changed[0];
  });

  /** Sourdine : plus de notification push pour cette conversation. */
  app.patch('/api/conversations/:id/mute', async (req) => {
    const me = requireUser(req);
    const c = await ownConversation(uuidParam(req.params), me.id);
    const { muted } = parse(z.object({ muted: z.boolean() }), req.body);
    await db
      .update(conversationMembers)
      .set({ muted })
      .where(and(eq(conversationMembers.conversationId, c.id), eq(conversationMembers.userId, me.id)));
    return { muted };
  });

  /** Réaction emoji à un message (une par personne, modifiable). */
  app.put('/api/messages/:id/reaction', perMinute(60), async (req) => {
    const me = requireUser(req);
    const { emoji } = parse(z.object({ emoji: z.enum(MESSAGE_REACTIONS) }), req.body);
    const m = await reactable(uuidParam(req.params), me.id);
    await db
      .insert(messageReactions)
      .values({ messageId: m.id, userId: me.id, emoji })
      .onConflictDoUpdate({ target: [messageReactions.messageId, messageReactions.userId], set: { emoji, createdAt: new Date() } });
    const reactions = await broadcastReactions(m);
    if (m.senderId !== me.id) {
      sendPush(
        m.senderId,
        { title: me.displayName, body: `A réagi ${emoji} à ton message`, url: `/messages/${m.conversationId}`, tag: `dm:${m.conversationId}` },
        'message',
      ).catch(() => {});
    }
    return reactions;
  });

  app.delete('/api/messages/:id/reaction', async (req) => {
    const me = requireUser(req);
    const m = await reactable(uuidParam(req.params), me.id);
    await db.delete(messageReactions).where(and(eq(messageReactions.messageId, m.id), eq(messageReactions.userId, me.id)));
    return broadcastReactions(m);
  });

  /** Réponse à une story : ouvre (ou crée) la conversation avec l'auteur. */
  app.post('/api/messages/to/:id', perMinute(20), async (req) => {
    const me = requireUser(req);
    const to = uuidParam(req.params);
    const body = parse(textSchema.extend({ storyId: z.string().uuid().optional() }), req.body);
    let meta: MessageMeta = null;
    if (body.storyId) {
      // On garde la photo de la story : elle reste visible dans la conversation après expiration.
      const [story] = await db
        .select({ authorId: schema.stories.authorId, media: schema.media })
        .from(schema.stories)
        .innerJoin(schema.media, eq(schema.media.id, schema.stories.mediaId))
        .where(eq(schema.stories.id, body.storyId))
        .limit(1);
      meta = { type: 'story_reply', storyId: body.storyId, media: story && story.authorId === to ? mediaRef(story.media) : null };
    }
    return sendDm(me, to, body.text, meta);
  });

  /** Invitation à un salon Make It Friends. */
  app.post('/api/game/invite', perMinute(10), async (req) => {
    const me = requireUser(req);
    const body = parse(z.object({ code: z.string().regex(/^MDRX-\d{3}$/), userIds: z.array(z.string().uuid()).min(1).max(8) }), req.body);
    let sent = 0;
    for (const uid of body.userIds) {
      if (!(await areFriends(me.id, uid)) || uid === me.id) continue;
      await sendDm(me, uid, `Rejoins mon salon Make It Friends, code ${body.code}.`, { type: 'game_invite', code: body.code });
      await notify({ userId: uid, type: 'game_invite', actorId: me.id, data: { code: body.code }, dedupeKey: `game_invite:${me.id}` });
      sent++;
    }
    return { sent };
  });
}
