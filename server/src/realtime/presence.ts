import type { Presence } from '@mandrix/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { friendIds } from '../lib/users.js';
import { emitToUser } from './io.js';

// Présence : nombre de connexions temps réel ouvertes par compte (plusieurs appareils possibles).
const sockets = new Map<string, number>();

export const isOnline = (userId: string) => (sockets.get(userId) ?? 0) > 0;

/** Prévient les amis qui montrent aussi leur présence. */
async function broadcast(userId: string, presence: Presence) {
  const [u] = await db.select({ show: schema.users.showPresence }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!u?.show) return;
  const friends = await friendIds(userId);
  if (friends.length === 0) return;
  const shows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(inArray(schema.users.id, friends), eq(schema.users.showPresence, true)));
  for (const f of shows) emitToUser(f.id, 'presence', { userId, ...presence });
}

export async function socketConnected(userId: string) {
  const n = (sockets.get(userId) ?? 0) + 1;
  sockets.set(userId, n);
  if (n === 1) await broadcast(userId, { online: true, lastSeenAt: null });
}

export async function socketDisconnected(userId: string) {
  const n = (sockets.get(userId) ?? 1) - 1;
  if (n > 0) return void sockets.set(userId, n);
  sockets.delete(userId);
  const at = new Date();
  await db.update(schema.users).set({ lastSeenAt: at }).where(eq(schema.users.id, userId));
  // Reconnecté entre-temps (changement de réseau) : pas d'« hors ligne » après le « en ligne ».
  if (isOnline(userId)) return;
  await broadcast(userId, { online: false, lastSeenAt: at.toISOString() });
}

/** Présence de quelques comptes vue par `viewer` ; vide si lui-même masque la sienne. */
export async function presenceOf(viewer: { id: string; showPresence: boolean }, ids: string[]) {
  const map = new Map<string, Presence>();
  if (!viewer.showPresence || ids.length === 0) return map;
  // Seulement des amis : un ancien ami (ou bloqué) garde la conversation mais plus la présence.
  const friends = new Set(await friendIds(viewer.id));
  ids = ids.filter((id) => friends.has(id));
  if (ids.length === 0) return map;
  const rows = await db
    .select({ id: schema.users.id, show: schema.users.showPresence, lastSeenAt: schema.users.lastSeenAt })
    .from(schema.users)
    .where(inArray(schema.users.id, ids));
  for (const r of rows) if (r.show) map.set(r.id, { online: isOnline(r.id), lastSeenAt: r.lastSeenAt?.toISOString() ?? null });
  return map;
}

/** Changement de réglage : les amis voient tout de suite la présence apparaître ou disparaître. */
export async function presenceChanged(userId: string, show: boolean) {
  const friends = await friendIds(userId);
  if (friends.length === 0) return;
  const [u] = await db.select({ lastSeenAt: schema.users.lastSeenAt }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  const payload = show ? { online: isOnline(userId), lastSeenAt: u?.lastSeenAt?.toISOString() ?? null } : { online: false, lastSeenAt: null };
  // Comme pour les autres évènements : seulement les amis qui montrent aussi leur présence.
  const shows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(inArray(schema.users.id, friends), eq(schema.users.showPresence, true)));
  for (const f of shows) emitToUser(f.id, 'presence', { userId, ...payload });
}
