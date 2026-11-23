import type { AppNotification, Badges } from '@mandrix/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireUser } from '../lib/auth.js';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';
import { fail, parse } from '../lib/http.js';
import { badgesFor, emitBadges, notify, serializeNotification } from '../lib/notify.js';
import { usersByIds } from '../lib/users.js';

const { notifications, pushSubscriptions } = schema;

const sameToken = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export default async function notificationRoutes(app: FastifyInstance) {
  /**
   * Alerte de supervision du homelab (NAS éteint, site injoignable, sauvegarde illisible…) :
   * notification et push à tous les admins. Protégée par ALERT_TOKEN ; désactivée sans lui.
   */
  app.post('/api/internal/alert', async (req) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!env.alertToken) return fail(404, 'Introuvable');
    if (!token || !sameToken(token, env.alertToken)) return fail(401, 'Jeton invalide');
    const body = parse(z.object({ title: z.string().trim().min(1).max(80), body: z.string().trim().max(300).default(''), key: z.string().max(60).optional() }), req.body);
    const admins = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.isAdmin, true));
    for (const a of admins) {
      await notify({
        userId: a.id,
        type: 'alert',
        data: { title: body.title, body: body.body },
        dedupeKey: body.key ? `alert:${body.key}` : undefined,
        push: { title: body.title, body: body.body, url: '/notifications', tag: body.key ? `alert:${body.key}` : 'alert' },
      });
    }
    return { sent: admins.length };
  });

  app.get('/api/notifications', async (req): Promise<AppNotification[]> => {
    const me = requireUser(req);
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, me.id))
      .orderBy(desc(notifications.createdAt))
      .limit(60);
    const actors = await usersByIds(rows.map((r) => r.actorId), me.id);
    return rows.map((r) => serializeNotification(r, r.actorId ? (actors.get(r.actorId) ?? null) : null));
  });

  app.post('/api/notifications/read', async (req) => {
    const me = requireUser(req);
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, me.id), isNull(notifications.readAt)));
    await emitBadges(me.id);
    return { ok: true };
  });

  app.get('/api/badges', async (req): Promise<Badges> => badgesFor(requireUser(req).id));

  const subSchema = z.object({
    endpoint: z.string().url().max(1000),
    keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
  });

  app.post('/api/push/subscribe', async (req) => {
    const me = requireUser(req);
    const body = parse(subSchema, req.body);
    await db
      .insert(pushSubscriptions)
      .values({ endpoint: body.endpoint, userId: me.id, p256dh: body.keys.p256dh, auth: body.keys.auth })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: me.id, p256dh: body.keys.p256dh, auth: body.keys.auth },
      });
    return { ok: true };
  });

  app.post('/api/push/unsubscribe', async (req) => {
    const me = requireUser(req);
    const { endpoint } = parse(z.object({ endpoint: z.string() }), req.body);
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, me.id)));
    return { ok: true };
  });
}
