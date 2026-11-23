import type { Conversation, Message, MessageMeta } from '@mandrix/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireUser, type AuthUser } from '../lib/auth.js';
import { fail, parse, uuidParam } from '../lib/http.js';
import { emitBadges, notify } from '../lib/notify.js';
import { sendPush } from '../lib/push.js';
import { areFriends, usersByIds } from '../lib/users.js';
import { emitToUser } from '../realtime/io.js';

const { conversations, messages, conversationReads } = schema;

const toMessage = (m: typeof messages.$inferSelect): Message => ({
  id: m.id,
  conversationId: m.conversationId,
  senderId: m.senderId,
  text: m.text,
  meta: (m.meta as MessageMeta) ?? null,
  createdAt: m.createdAt.toISOString(),
});

export async function getOrCreateConversation(a: string, b: string) {
  const [userA, userB] = a < b ? [a, b] : [b, a];
  const [existing] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.userA, userA), eq(conversations.userB, userB)))
    .limit(1);
  if (existing) return existing;
  const [created] = await db.insert(conversations).values({ userA, userB }).onConflictDoNothing().returning();
  if (created) return created;
  const [again] = await db.select().from(conversations).where(and(eq(conversations.userA, userA), eq(conversations.userB, userB)));
  return again;
}

async function markRead(conversationId: string, userId: string) {
  const now = new Date();
  await db
    .insert(conversationReads)
    .values({ conversationId, userId, lastReadAt: now })
    .onConflictDoUpdate({ target: [conversationReads.conversationId, conversationReads.userId], set: { lastReadAt: now } });
}

export async function sendDm(from: AuthUser, toUserId: string, text: string, meta: MessageMeta = null) {
  if (!(await areFriends(from.id, toUserId))) fail(403, 'Tu ne peux écrire qu’à tes amis');
  const conv = await getOrCreateConversation(from.id, toUserId);
  const [m] = await db.insert(messages).values({ conversationId: conv.id, senderId: from.id, text, meta }).returning();
  await db.update(conversations).set({ lastMessageAt: m.createdAt }).where(eq(conversations.id, conv.id));
  await markRead(conv.id, from.id);
  const msg = toMessage(m);
  emitToUser(from.id, 'dm:new', msg);
  emitToUser(toUserId, 'dm:new', msg);
  await emitBadges(toUserId);
  sendPush(toUserId, { title: from.displayName, body: text.slice(0, 120), url: `/messages/${conv.id}`, tag: `dm:${conv.id}` }).catch(() => {});
  return msg;
}

async function ownConversation(id: string, userId: string) {
  const [c] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  if (!c || (c.userA !== userId && c.userB !== userId)) fail(404, 'Conversation introuvable');
  return c!;
}

const textSchema = z.object({ text: z.string().trim().min(1, 'Message vide').max(1000) });

export default async function messageRoutes(app: FastifyInstance) {
  app.get('/api/conversations', async (req): Promise<Conversation[]> => {
    const me = requireUser(req);
    const rows = await db.execute<{ id: string; other: string; text: string | null; at: Date | null; senderId: string | null; unread: boolean }>(sql`
      select c.id,
        case when c.user_a = ${me.id} then c.user_b else c.user_a end as other,
        lm.text, lm.created_at as at, lm.sender_id as "senderId",
        exists(
          select 1 from messages msg where msg.conversation_id = c.id and msg.sender_id <> ${me.id}
            and msg.created_at > coalesce((select r.last_read_at from conversation_reads r where r.conversation_id = c.id and r.user_id = ${me.id}), 'epoch'::timestamptz)
        ) as unread
      from conversations c
      left join lateral (
        select m.text, m.created_at, m.sender_id from messages m where m.conversation_id = c.id order by m.created_at desc limit 1
      ) lm on true
      where c.user_a = ${me.id} or c.user_b = ${me.id}
      order by c.last_message_at desc limit 100`);
    const list = [...rows];
    const users = await usersByIds(list.map((r) => r.other));
    return list.map((r) => ({
      id: r.id,
      user: users.get(r.other)!,
      last: r.at ? { text: r.text ?? '', at: new Date(r.at).toISOString(), mine: r.senderId === me.id } : null,
      unread: r.unread,
    }));
  });

  app.post('/api/conversations', async (req) => {
    const me = requireUser(req);
    const { userId } = parse(z.object({ userId: z.string().uuid() }), req.body);
    if (!(await areFriends(me.id, userId)) || userId === me.id) fail(403, 'Tu ne peux écrire qu’à tes amis');
    const conv = await getOrCreateConversation(me.id, userId);
    return { id: conv.id };
  });

  app.get('/api/conversations/:id', async (req) => {
    const me = requireUser(req);
    const c = await ownConversation(uuidParam(req.params), me.id);
    const other = c.userA === me.id ? c.userB : c.userA;
    const users = await usersByIds([other]);
    return { id: c.id, user: users.get(other)! };
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
    return rows.reverse().map(toMessage);
  });

  app.post('/api/conversations/:id/messages', async (req) => {
    const me = requireUser(req);
    const c = await ownConversation(uuidParam(req.params), me.id);
    const { text } = parse(textSchema, req.body);
    return sendDm(me, c.userA === me.id ? c.userB : c.userA, text);
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
    return sendDm(me, to, body.text, body.storyId ? { type: 'story_reply', storyId: body.storyId } : null);
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
