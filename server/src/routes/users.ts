import { USERNAME_RE, type FriendsList, type InviteInfo, type ProfilePosts, type UserProfile, type UserSearchResult } from '@mandrix/shared';
import { and, eq, ilike, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireUser } from '../lib/auth.js';
import { fail, parse, uuidParam } from '../lib/http.js';
import { isBlockedBetween } from '../lib/blocks.js';
import { ensureInviteCode } from '../lib/invite.js';
import { env } from '../env.js';
import { saveUpload } from '../lib/media.js';
import { emitBadges, notify } from '../lib/notify.js';
import { notBlocked, selectPosts } from '../lib/posts.js';
import { streakFor } from '../lib/streak.js';
import { areFriends, friendIds, friendshipMap, toLite, toMe, usersByIds } from '../lib/users.js';
import { perMinute } from '../lib/limits.js';

const { users, friendships } = schema;

const profileSchema = z.object({
  displayName: z.string().trim().min(1, 'Ton nom ne peut pas être vide').max(40).optional(),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(USERNAME_RE, 'Pseudo : 3 à 20 caractères (lettres, chiffres, point, tiret bas)')
    .optional(),
  city: z.string().trim().max(60).nullable().optional(),
  bio: z.string().trim().max(160).nullable().optional(),
  /** « MM-JJ » ou null pour l'effacer. */
  birthday: z
    .string()
    .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Date d’anniversaire invalide')
    .refine((v) => !Number.isNaN(Date.parse(`2024-${v}T12:00:00Z`)) && new Date(`2024-${v}T12:00:00Z`).toISOString().slice(5, 10) === v, 'Date d’anniversaire invalide')
    .nullable()
    .optional(),
});

export default async function userRoutes(app: FastifyInstance) {
  app.patch('/api/me', async (req) => {
    const me = requireUser(req);
    const body = parse(profileSchema, req.body);
    if (body.username && body.username !== me.username) {
      const taken = await db.select({ id: users.id }).from(users).where(eq(users.username, body.username)).limit(1);
      if (taken[0]) fail(409, 'Ce pseudo est déjà pris');
    }
    const [u] = await db
      .update(users)
      .set({
        displayName: body.displayName ?? me.displayName,
        username: body.username ?? me.username,
        city: body.city === undefined ? me.city : body.city || null,
        bio: body.bio === undefined ? me.bio : body.bio || null,
        birthday: body.birthday === undefined ? me.birthday : body.birthday,
      })
      .where(eq(users.id, me.id))
      .returning();
    return toMe(u);
  });

  /** Épingler un de ses posts en tête de son profil (null pour désépingler). */
  app.put('/api/me/pinned-post', async (req) => {
    const me = requireUser(req);
    const { postId } = parse(z.object({ postId: z.string().uuid().nullable() }), req.body);
    if (postId) {
      const [p] = await db.select({ authorId: schema.posts.authorId, kind: schema.posts.kind }).from(schema.posts).where(eq(schema.posts.id, postId)).limit(1);
      if (!p || p.authorId !== me.id) return fail(404, 'Post introuvable');
      if (p.kind === 'meme') fail(400, 'Les mèmes ne s’épinglent pas');
    }
    await db.update(users).set({ pinnedPostId: postId }).where(eq(users.id, me.id));
    return { pinnedPostId: postId };
  });

  app.get('/api/me/invite', async (req): Promise<InviteInfo> => {
    const me = requireUser(req);
    const code = await ensureInviteCode(me.id, me.username);
    const [r] = await db.execute<{ n: number }>(sql`select count(*)::int as n from users where invited_by = ${me.id}`);
    return { code, link: `${env.appUrl}/?parrain=${encodeURIComponent(code)}`, invited: r?.n ?? 0 };
  });

  app.post('/api/me/avatar', async (req) => {
    const me = requireUser(req);
    const file = await req.file();
    if (!file) return fail(400, 'Aucune image reçue');
    const m = await saveUpload(file, me.id, { accept: 'image', maxSide: 512 });
    const [u] = await db.update(users).set({ avatarMediaId: m.id }).where(eq(users.id, me.id)).returning();
    return toMe(u);
  });

  app.get('/api/users/search', async (req): Promise<UserSearchResult[]> => {
    const me = requireUser(req);
    const q = String((req.query as { q?: string }).q ?? '').trim().replace(/[%_\\]/g, '');
    if (q.length < 2) return [];
    const rows = await db
      .select({ id: users.id, username: users.username, displayName: users.displayName, avatarMediaId: users.avatarMediaId })
      .from(users)
      .where(
        and(
          ne(users.id, me.id),
          or(ilike(users.username, `%${q}%`), ilike(users.displayName, `%${q}%`)),
          notBlocked(me.id, sql`${users.id}`),
        ),
      )
      .limit(20);
    const fm = await friendshipMap(me.id, rows.map((r) => r.id));
    return rows.map((r) => ({ ...toLite(r), friendship: fm.get(r.id) ?? 'none' }));
  });

  app.get('/api/users/:username', async (req): Promise<UserProfile> => {
    const me = requireUser(req);
    const { username } = req.params as { username: string };
    const [u] = await db.select().from(users).where(eq(users.username, username.toLowerCase())).limit(1);
    if (!u) return fail(404, 'Utilisateur introuvable');
    const [blockRow] = await db
      .select()
      .from(schema.blocks)
      .where(or(and(eq(schema.blocks.blockerId, me.id), eq(schema.blocks.blockedId, u.id)), and(eq(schema.blocks.blockerId, u.id), eq(schema.blocks.blockedId, me.id))))
      .limit(1);
    // Bloqué par cette personne : son profil n'existe plus pour moi.
    if (blockRow && blockRow.blockerId === u.id) return fail(404, 'Utilisateur introuvable');
    const [stats] = await db.execute<{ posts: number; memesWon: number }>(sql`
      select
        (select count(*)::int from posts where author_id = ${u.id}) as posts,
        (select count(*)::int from memes where author_id = ${u.id} and is_winner) as "memesWon"`);
    const friends = await friendIds(u.id);
    const fm = await friendshipMap(me.id, [u.id]);
    return {
      ...toLite(u, u.id === me.id || fm.get(u.id) === 'friends'),
      city: u.city,
      bio: u.bio,
      stats: { posts: stats.posts, friends: friends.length, memesWon: stats.memesWon },
      streak: await streakFor(u.id),
      friendship: fm.get(u.id) ?? 'none',
      blockedByMe: !!blockRow,
      // Anniversaire visible par soi-même et ses amis seulement.
      birthday: u.id === me.id || fm.get(u.id) === 'friends' ? u.birthday : null,
      pinnedPostId: u.id === me.id || fm.get(u.id) === 'friends' ? u.pinnedPostId : null,
    };
  });

  app.get('/api/users/:username/posts', async (req): Promise<ProfilePosts> => {
    const me = requireUser(req);
    const { username } = req.params as { username: string };
    const tab = String((req.query as { tab?: string }).tab ?? 'posts');
    const page = Math.max(0, Number((req.query as { page?: string }).page ?? 0) || 0);
    const [u] = await db.select({ id: users.id, pinnedPostId: users.pinnedPostId }).from(users).where(eq(users.username, username.toLowerCase())).limit(1);
    if (!u) return fail(404, 'Utilisateur introuvable');
    const kindFilter =
      tab === 'reels' ? sql`p.kind = 'video'` : tab === 'memes' ? sql`p.kind = 'meme'` : sql`p.kind in ('photo','video','poll')`;
    const visible = tab === 'memes' || (await areFriends(me.id, u.id));
    if (!visible) return { items: [], next: null, locked: true, pinned: null };
    // Onglet « Posts » : le post épinglé passe en tête, à part.
    const pinId = tab === 'posts' ? u.pinnedPostId : null;
    const items = await selectPosts(me.id, {
      where: sql`p.author_id = ${u.id} and ${kindFilter} ${pinId ? sql`and p.id <> ${pinId}` : sql``}`,
      limit: 30,
      offset: page * 30,
    });
    const pinned = pinId && page === 0 ? ((await selectPosts(me.id, { where: sql`p.id = ${pinId} and p.author_id = ${u.id}`, limit: 1 }))[0] ?? null) : null;
    return { items, next: items.length === 30 ? page + 1 : null, locked: false, pinned };
  });

  // ——— Amis ———

  app.get('/api/friends', async (req): Promise<FriendsList> => {
    const me = requireUser(req);
    const rows = await db
      .select()
      .from(friendships)
      .where(or(eq(friendships.requesterId, me.id), eq(friendships.addresseeId, me.id)));
    const map = await usersByIds(rows.flatMap((r) => [r.requesterId, r.addresseeId]), me.id);
    const other = (r: (typeof rows)[number]) => map.get(r.requesterId === me.id ? r.addresseeId : r.requesterId)!;
    const byName = (a: { displayName: string }, b: { displayName: string }) => a.displayName.localeCompare(b.displayName, 'fr');
    return {
      friends: rows.filter((r) => r.status === 'accepted').map(other).sort(byName),
      incoming: rows.filter((r) => r.status === 'pending' && r.addresseeId === me.id).map(other),
      outgoing: rows.filter((r) => r.status === 'pending' && r.requesterId === me.id).map(other),
    };
  });

  /** Envoie une demande, ou accepte celle reçue. */
  app.post('/api/friends/:id', perMinute(30), async (req) => {
    const me = requireUser(req);
    const otherId = uuidParam(req.params);
    if (otherId === me.id) fail(400, 'Tu ne peux pas t’ajouter toi-même');
    const [other] = await db.select({ id: users.id }).from(users).where(eq(users.id, otherId)).limit(1);
    if (!other) fail(404, 'Utilisateur introuvable');
    if (await isBlockedBetween(me.id, otherId)) fail(403, 'Impossible d’ajouter cette personne');

    const [incoming] = await db
      .select()
      .from(friendships)
      .where(and(eq(friendships.requesterId, otherId), eq(friendships.addresseeId, me.id)))
      .limit(1);
    if (incoming) {
      if (incoming.status !== 'accepted') {
        await db
          .update(friendships)
          .set({ status: 'accepted' })
          .where(and(eq(friendships.requesterId, otherId), eq(friendships.addresseeId, me.id)));
        await db.delete(schema.notifications).where(
          and(eq(schema.notifications.userId, me.id), eq(schema.notifications.type, 'friend_request'), eq(schema.notifications.actorId, otherId)),
        );
        await emitBadges(me.id);
        await notify({
          userId: otherId,
          type: 'friend_accept',
          actorId: me.id,
          push: { title: 'Nouvel ami', body: `${me.displayName} a accepté ta demande`, url: `/u/${me.username}`, tag: 'friend' },
        });
      }
      return { friendship: 'friends' };
    }
    const inserted = await db
      .insert(friendships)
      .values({ requesterId: me.id, addresseeId: otherId, status: 'pending' })
      .onConflictDoNothing()
      .returning();
    if (inserted.length) {
      await notify({
        userId: otherId,
        type: 'friend_request',
        actorId: me.id,
        dedupeKey: `friend_request:${me.id}`,
        push: { title: 'Demande d’ami', body: `${me.displayName} veut devenir ton ami·e`, url: '/notifications', tag: 'friend' },
      });
    }
    return { friendship: 'pending_out' };
  });

  /** Annule, refuse ou retire un ami. */
  app.delete('/api/friends/:id', async (req) => {
    const me = requireUser(req);
    const otherId = uuidParam(req.params);
    await db
      .delete(friendships)
      .where(
        or(
          and(eq(friendships.requesterId, me.id), eq(friendships.addresseeId, otherId)),
          and(eq(friendships.requesterId, otherId), eq(friendships.addresseeId, me.id)),
        ),
      );
    await db.delete(schema.notifications).where(
      and(eq(schema.notifications.userId, me.id), eq(schema.notifications.type, 'friend_request'), eq(schema.notifications.actorId, otherId)),
    );
    await emitBadges(me.id);
    return { friendship: 'none' };
  });
}
