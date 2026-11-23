import { notifCategory, type AppNotification, type Badges, type NotificationType, type UserLite } from '@mandrix/shared';
import { sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { emitToUser } from '../realtime/io.js';
import { prefsOf, sendPush, type PushPayload } from './push.js';
import { usersByIds } from './users.js';

type NotifRow = typeof schema.notifications.$inferSelect;

export function serializeNotification(row: NotifRow, actor: UserLite | null): AppNotification {
  return {
    id: row.id,
    type: row.type as NotificationType,
    actor,
    data: row.data ?? {},
    createdAt: row.createdAt.toISOString(),
    read: !!row.readAt,
  };
}

export async function badgesFor(userId: string): Promise<Badges> {
  const [n] = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from notifications where user_id = ${userId} and read_at is null`,
  );
  const [m] = await db.execute<{ m: number }>(sql`
    select count(*)::int as m from conversations c
    join conversation_members cm on cm.conversation_id = c.id and cm.user_id = ${userId}
    where exists (
        select 1 from messages msg
        where msg.conversation_id = c.id and msg.sender_id <> ${userId}
          and msg.created_at > coalesce(
            (select r.last_read_at from conversation_reads r where r.conversation_id = c.id and r.user_id = ${userId}),
            'epoch'::timestamptz)
      )`);
  return { notifications: n?.n ?? 0, messages: m?.m ?? 0 };
}

export async function emitBadges(userId: string) {
  emitToUser(userId, 'badges', await badgesFor(userId));
}

interface NotifyOpts {
  userId: string;
  type: NotificationType;
  actorId?: string | null;
  data?: Record<string, unknown>;
  dedupeKey?: string;
  push?: PushPayload | null;
}

export async function notify(opts: NotifyOpts) {
  if (opts.actorId && opts.actorId === opts.userId) return;
  if (opts.push) sendPush(opts.userId, opts.push, opts.type).catch(() => {});
  // Catégorie coupée dans la cloche : rien n'est enregistré.
  const prefs = (await prefsOf([opts.userId])).get(opts.userId) ?? {};
  if (prefs.bell?.[notifCategory(opts.type)] === false) return;
  const values = {
    userId: opts.userId,
    type: opts.type,
    actorId: opts.actorId ?? null,
    data: opts.data ?? {},
    dedupeKey: opts.dedupeKey ?? null,
  };
  const n = schema.notifications;
  const [row] = opts.dedupeKey
    ? await db
        .insert(n)
        .values(values)
        .onConflictDoUpdate({
          target: [n.userId, n.dedupeKey],
          set: { data: values.data, createdAt: new Date(), readAt: null },
        })
        .returning()
    : await db.insert(n).values(values).returning();

  const actor = opts.actorId ? ((await usersByIds([opts.actorId])).get(opts.actorId) ?? null) : null;
  emitToUser(opts.userId, 'notif:new', serializeNotification(row, actor));
  await emitBadges(opts.userId);
}

/** Notification de masse (déballage du dimanche, rappels…). */
export async function notifyMany(userIds: string[], type: NotificationType, data: Record<string, unknown>, push: PushPayload | null, dedupeKey?: string) {
  for (const userId of userIds) {
    await notify({ userId, type, data, push: null, dedupeKey });
  }
  if (push && userIds.length) await sendPush(userIds, push, type).catch(() => {});
}
