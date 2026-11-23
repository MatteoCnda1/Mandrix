import { notifCategory, type NotifCategory, type NotificationPrefs, type NotificationType } from '@mandrix/shared';
import { eq, inArray } from 'drizzle-orm';
import webpush from 'web-push';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';

let publicKey: string | null = null;

async function getSetting(key: string) {
  const rows = await db.select().from(schema.settings).where(eq(schema.settings.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

export async function initPush() {
  let pub = env.vapidPublic;
  let priv = env.vapidPrivate;
  if (!pub || !priv) {
    // Clés VAPID générées au premier démarrage puis conservées en base.
    pub = await getSetting('vapid_public');
    priv = await getSetting('vapid_private');
    if (!pub || !priv) {
      const keys = webpush.generateVAPIDKeys();
      pub = keys.publicKey;
      priv = keys.privateKey;
      await db
        .insert(schema.settings)
        .values([
          { key: 'vapid_public', value: pub },
          { key: 'vapid_private', value: priv },
        ])
        .onConflictDoNothing();
    }
  }
  const subject = env.vapidSubject ?? (env.appUrl.startsWith('https://') ? env.appUrl : 'mailto:admin@mandrix.local');
  webpush.setVapidDetails(subject, pub, priv);
  publicKey = pub;
}

export const vapidPublicKey = () => publicKey;

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/** Heure de Paris (0–23), quel que soit le fuseau du serveur. */
export function parisHour(d = new Date()) {
  return Number(new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Paris' }).format(d));
}

export function inQuietHours(prefs: NotificationPrefs, hour = parisHour()) {
  const q = prefs.quiet;
  if (!q || q.start === q.end) return false;
  return q.start < q.end ? hour >= q.start && hour < q.end : hour >= q.start || hour < q.end;
}

export async function prefsOf(ids: string[]) {
  const map = new Map<string, NotificationPrefs>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({ id: schema.users.id, prefs: schema.users.notificationPrefs })
    .from(schema.users)
    .where(inArray(schema.users.id, ids));
  for (const r of rows) map.set(r.id, r.prefs ?? {});
  return map;
}

/** Garde les destinataires qui acceptent ce push maintenant (catégorie active, hors heures calmes). */
export async function pushRecipients(ids: string[], category: NotifCategory) {
  const prefs = await prefsOf(ids);
  return ids.filter((id) => {
    const p = prefs.get(id) ?? {};
    return p.push?.[category] !== false && !inQuietHours(p);
  });
}

/**
 * Envoie un push. `kind` (type de notification ou « message ») applique les préférences
 * de chaque destinataire ; sans `kind`, l'envoi est inconditionnel.
 */
export async function sendPush(userIds: string | string[], payload: PushPayload, kind?: NotificationType | 'message') {
  if (!publicKey) return;
  let ids = Array.isArray(userIds) ? userIds : [userIds];
  if (kind) ids = await pushRecipients(ids, notifCategory(kind));
  if (ids.length === 0) return;
  const subs = await db.select().from(schema.pushSubscriptions).where(inArray(schema.pushSubscriptions.userId, ids));
  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
          TTL: 60 * 60 * 24,
        });
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, s.endpoint));
        }
      }
    }),
  );
}
