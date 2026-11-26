import { initialsOf, toneOf, type Friendship, type Me, type UserLite } from '@mandrix/shared';
import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

const { users, friendships } = schema;
type UserRow = Pick<typeof users.$inferSelect, 'id' | 'username' | 'displayName' | 'avatarMediaId'> & { birthday?: string | null };

/** « MM-JJ » du jour, à Paris. */
export const parisMonthDay = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', month: '2-digit', day: '2-digit' }).format(d).replace('/', '-');

/** Anniversaire aujourd'hui (à Paris) ; né un 29 février : fêté le 28 les années non bissextiles. */
export function isBirthdayToday(birthday: string | null | undefined, now = new Date()) {
  if (!birthday) return false;
  const today = parisMonthDay(now);
  if (birthday === today) return true;
  const year = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric' }).format(now));
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return birthday === '02-29' && today === '02-28' && !leap;
}

/**
 * Utilisateur en bref. Le 🎂 du jour n'est montré qu'à ses amis (`withBirthday`) :
 * l'anniversaire reste privé, comme sur le profil.
 */
export function toLite(u: UserRow, withBirthday = false): UserLite {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatarMediaId ? `/media/${u.avatarMediaId}` : null,
    initials: initialsOf(u.displayName),
    tone: toneOf(u.id),
    ...(withBirthday && isBirthdayToday(u.birthday) ? { birthdayToday: true } : {}),
  };
}

export function toMe(u: typeof users.$inferSelect): Me {
  return {
    ...toLite(u, true),
    email: u.email,
    city: u.city,
    bio: u.bio,
    isAdmin: u.isAdmin,
    canInvite: u.canInvite,
    createdAt: u.createdAt.toISOString(),
    notificationPrefs: u.notificationPrefs ?? {},
    showPresence: u.showPresence,
    birthday: u.birthday,
    pinnedPostId: u.pinnedPostId,
  };
}

/** Utilisateurs en bref. Avec `viewerId`, le 🎂 du jour apparaît pour le lecteur et ses amis. */
export async function usersByIds(ids: Iterable<string | null | undefined>, viewerId?: string): Promise<Map<string, UserLite>> {
  const list = [...new Set([...ids].filter((x): x is string => !!x))];
  const map = new Map<string, UserLite>();
  if (list.length === 0) return map;
  const rows = await db
    .select({ id: users.id, username: users.username, displayName: users.displayName, avatarMediaId: users.avatarMediaId, birthday: users.birthday })
    .from(users)
    .where(inArray(users.id, list));
  const celebrating = viewerId ? rows.filter((r) => isBirthdayToday(r.birthday)) : [];
  const circle = celebrating.length ? new Set([viewerId!, ...(await friendIds(viewerId!))]) : new Set<string>();
  for (const r of rows) map.set(r.id, toLite(r, circle.has(r.id)));
  return map;
}

export async function friendIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ a: friendships.requesterId, b: friendships.addresseeId })
    .from(friendships)
    .where(
      and(
        eq(friendships.status, 'accepted'),
        or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId)),
      ),
    );
  return rows.map((r) => (r.a === userId ? r.b : r.a));
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  if (a === b) return true;
  const rows = await db
    .select({ s: friendships.status })
    .from(friendships)
    .where(
      and(
        eq(friendships.status, 'accepted'),
        or(
          and(eq(friendships.requesterId, a), eq(friendships.addresseeId, b)),
          and(eq(friendships.requesterId, b), eq(friendships.addresseeId, a)),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function friendshipMap(viewerId: string, otherIds: string[]): Promise<Map<string, Friendship>> {
  const map = new Map<string, Friendship>();
  for (const id of otherIds) map.set(id, id === viewerId ? 'self' : 'none');
  const others = otherIds.filter((id) => id !== viewerId);
  if (others.length === 0) return map;
  const rows = await db
    .select()
    .from(friendships)
    .where(
      or(
        and(eq(friendships.requesterId, viewerId), inArray(friendships.addresseeId, others)),
        and(eq(friendships.addresseeId, viewerId), inArray(friendships.requesterId, others)),
      ),
    );
  for (const r of rows) {
    const other = r.requesterId === viewerId ? r.addresseeId : r.requesterId;
    if (r.status === 'accepted') map.set(other, 'friends');
    else map.set(other, r.requesterId === viewerId ? 'pending_out' : 'pending_in');
  }
  return map;
}

/** Construit `ARRAY[...]::uuid[]` pour les requêtes SQL brutes. */
export function uuidArray(ids: string[]): SQL {
  if (ids.length === 0) return sql`ARRAY[]::uuid[]`;
  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`;
}
