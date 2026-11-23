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

export async function sendPush(userIds: string | string[], payload: PushPayload) {
  if (!publicKey) return;
  const ids = Array.isArray(userIds) ? userIds : [userIds];
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
