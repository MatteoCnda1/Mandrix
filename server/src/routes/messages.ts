import { attachmentLabel, GROUP_MAX_MEMBERS, type Conversation, type ConversationDetail, type MediaRef, type Message, type MessageMeta } from '@mandrix/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireUser, type AuthUser } from '../lib/auth.js';
import { fail, parse, uuidParam } from '../lib/http.js';
import { mediaRef } from '../lib/media.js';
import { emitBadges, notify } from '../lib/notify.js';
import { sendPush } from '../lib/push.js';
import { areFriends, friendIds, usersByIds } from '../lib/users.js';
import { emitToUser } from '../realtime/io.js';

const { conversations, conversationMembers, messages, conversationReads } = schema;

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

async function toMessages(rows: MessageRow[]): Promise<Message[]> {
  const media = await attachments(rows);
  return rows.map((m) => ({
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    text: m.text,
    meta: (m.meta as MessageMeta) ?? null,
    media: m.mediaId ? (media.get(m.mediaId) ?? null) : null,
    createdAt: m.createdAt.toISOString(),
  }));
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

async function markRead(conversationId: string, userId: string) {
  const now = new Date();
  await db
    .insert(conversationReads)
    .values({ conversationId, userId, lastReadAt: now })
    .onConflictDoUpdate({ target: [conversationReads.conversationId, conversationReads.userId], set: { lastReadAt: now } });
}

/** Publie un message dans une conversation et prévient tous ses membres. */
async function postMessage(conv: typeof conversations.$inferSelect, from: AuthUser, text: string, meta: MessageMeta = null, mediaId: string | null = null) {
  const [m] = await db.insert(messages).values({ conversationId: conv.id, senderId: from.id, text, meta, mediaId }).returning();
  await db.update(conversations).set({ lastMessageAt: m.createdAt }).where(eq(conversations.id, conv.id));
  await markRead(conv.id, from.id);
  const [msg] = await toMessages([m]);
  const members = await memberIds(conv.id);
  for (const uid of members) emitToUser(uid, 'dm:new', msg);
  const others = members.filter((id) => id !== from.id);
  for (const uid of others) await emitBadges(uid);
  if (meta?.type !== 'system' && others.length) {
    const title = conv.isGroup ? (conv.title ?? 'Groupe') : from.displayName;
    const content = text || attachmentLabel(msg.media?.kind, msg.media?.duration);
    const body = conv.isGroup ? `${from.displayName} : ${content}` : content;
    sendPush(others, { title, body: body.slice(0, 140), url: `/messages/${conv.id}`, tag: `dm:${conv.id}` }).catch(() => {});
  }
  return msg;
}

export async function sendDm(from: AuthUser, toUserId: string, text: string, meta: MessageMeta = null) {
  if (!(await areFriends(from.id, toUserId))) fail(403, 'Tu ne peux écrire qu’à tes amis');
  const conv = await getOrCreateConversation(from.id, toUserId);
  return postMessage(conv, from, text, meta);
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
  return { id: conv.id, isGroup: conv.isGroup, title: conv.title, user: other, members, createdBy: conv.createdBy };
}

/** Vérifie que tous les utilisateurs sont amis avec `me`. */
async function onlyFriends(meId: string, ids: string[]) {
  const friends = new Set(await friendIds(meId));
  const bad = ids.filter((id) => !friends.has(id));
  if (bad.length) fail(403, 'Tu ne peux ajouter que tes amis');
}

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
      unread: boolean;
    }>(sql`
      select c.id, c.is_group as "isGroup", c.title,
        array(select cm.user_id from conversation_members cm where cm.conversation_id = c.id and cm.user_id <> ${me.id} order by cm.created_at) as members,
        lm.text, lm.created_at as at, lm.sender_id as "senderId", lm.meta,
        lmm.kind as "mediaKind", lmm.duration as "mediaDuration",
        exists(
          select 1 from messages msg where msg.conversation_id = c.id and msg.sender_id <> ${me.id}
            and msg.created_at > coalesce((select r.last_read_at from conversation_reads r where r.conversation_id = c.id and r.user_id = ${me.id}), 'epoch'::timestamptz)
        ) as unread
      from conversations c
      join conversation_members mine on mine.conversation_id = c.id and mine.user_id = ${me.id}
      left join lateral (
        select m.text, m.created_at, m.sender_id, m.meta, m.media_id from messages m where m.conversation_id = c.id order by m.created_at desc limit 1
      ) lm on true
      left join media lmm on lmm.id = lm.media_id
      order by c.last_message_at desc limit 100`);
    const list = [...rows];
    const users = await usersByIds(list.flatMap((r) => [...r.members, r.senderId]));
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
                text: r.text || attachmentLabel(r.mediaKind, r.mediaDuration),
                at: new Date(r.at).toISOString(),
                mine: r.senderId === me.id,
                sender: r.isGroup && sender && r.senderId !== me.id ? firstName(sender.displayName) : null,
                system: r.meta?.type === 'system',
              }
            : null,
          unread: r.unread,
        };
      });
  });

  /** Conversation à deux (`userId`) ou groupe (`userIds` + `title`). */
  app.post('/api/conversations', async (req) => {
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
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, c.id))
      .orderBy(desc(messages.createdAt))
      .limit(200);
    await markRead(c.id, me.id);
    await emitBadges(me.id);
    return toMessages(rows.reverse());
  });

  app.post('/api/conversations/:id/messages', async (req) => {
    const me = requireUser(req);
    const c = await ownConversation(uuidParam(req.params), me.id);
    const body = parse(
      z
        .object({ text: z.string().trim().max(1000).default(''), mediaId: z.string().uuid().optional() })
        .refine((b) => b.text.length > 0 || !!b.mediaId, { message: 'Message vide' }),
      req.body,
    );
    if (body.mediaId) {
      const [m] = await db.select({ ownerId: schema.media.ownerId }).from(schema.media).where(eq(schema.media.id, body.mediaId)).limit(1);
      if (!m || m.ownerId !== me.id) fail(400, 'Pièce jointe introuvable');
    }
    return postMessage(c, me, body.text, null, body.mediaId ?? null);
  });

  app.post('/api/conversations/:id/read', async (req) => {
    const me = requireUser(req);
    const c = await ownConversation(uuidParam(req.params), me.id);
    await markRead(c.id, me.id);
    await emitBadges(me.id);
    return { ok: true };
  });

  /** Réponse à une story : ouvre (ou crée) la conversation avec l'auteur. */
  app.post('/api/messages/to/:id', async (req) => {
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
  app.post('/api/game/invite', async (req) => {
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
