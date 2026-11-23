import {
  REPORT_HIDE_THRESHOLD,
  REPORT_REASONS,
  type BlockedUser,
  type FriendSuggestion,
  type MediaRef,
  type ModerationCase,
  type PostSearch,
  type ReportTarget,
} from '@mandrix/shared';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';
import { randomToken, requireUser, sha256, type AuthUser } from '../lib/auth.js';
import { fail, parse, uuidParam } from '../lib/http.js';
import { mediaRef } from '../lib/media.js';
import { emitBadges } from '../lib/notify.js';
import { notBlocked, selectPosts } from '../lib/posts.js';
import { sendPush } from '../lib/push.js';
import { friendIds, toLite, usersByIds, uuidArray } from '../lib/users.js';
import { perMinute } from '../lib/limits.js';

const { users, friendships, blocks, reports } = schema;

const requireAdmin = (req: Parameters<typeof requireUser>[0]) => {
  const me = requireUser(req);
  if (!me.isAdmin) fail(403, 'Réservé aux administrateurs');
  return me;
};

/** Masque (ou ré-affiche) un contenu signalé. */
async function setHidden(type: ReportTarget, id: string, hidden: boolean) {
  const at = hidden ? new Date() : null;
  if (type === 'post') await db.update(schema.posts).set({ hiddenAt: at }).where(eq(schema.posts.id, id));
  if (type === 'comment') await db.update(schema.comments).set({ hiddenAt: at }).where(eq(schema.comments.id, id));
  if (type === 'story') await db.update(schema.stories).set({ hiddenAt: at }).where(eq(schema.stories.id, id));
}

/** Auteur, texte et média d'un contenu signalé (null s'il n'existe plus). */
async function describe(type: ReportTarget, id: string): Promise<{ authorId: string; text: string; media: MediaRef | null; url: string | null; hidden: boolean } | null> {
  if (type === 'post') {
    const [p] = await db
      .select({ p: schema.posts, m: schema.media })
      .from(schema.posts)
      .leftJoin(schema.media, eq(schema.media.id, schema.posts.mediaId))
      .where(eq(schema.posts.id, id))
      .limit(1);
    return p ? { authorId: p.p.authorId, text: p.p.text, media: p.m ? mediaRef(p.m) : null, url: `/p/${id}`, hidden: !!p.p.hiddenAt } : null;
  }
  if (type === 'comment') {
    const [c] = await db.select().from(schema.comments).where(eq(schema.comments.id, id)).limit(1);
    return c ? { authorId: c.authorId, text: c.text, media: null, url: `/p/${c.postId}`, hidden: !!c.hiddenAt } : null;
  }
  if (type === 'story') {
    const [s] = await db
      .select({ s: schema.stories, m: schema.media })
      .from(schema.stories)
      .innerJoin(schema.media, eq(schema.media.id, schema.stories.mediaId))
      .where(eq(schema.stories.id, id))
      .limit(1);
    return s ? { authorId: s.s.authorId, text: 'Story', media: mediaRef(s.m), url: null, hidden: !!s.s.hiddenAt } : null;
  }
  if (type === 'message') {
    const [m] = await db
      .select({ m: schema.messages, media: schema.media })
      .from(schema.messages)
      .leftJoin(schema.media, eq(schema.media.id, schema.messages.mediaId))
      .where(eq(schema.messages.id, id))
      .limit(1);
    return m ? { authorId: m.m.senderId, text: m.m.text, media: m.media ? mediaRef(m.media) : null, url: null, hidden: false } : null;
  }
  const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return u ? { authorId: u.id, text: u.bio ?? '', media: null, url: `/u/${u.username}`, hidden: false } : null;
}

async function deleteTarget(type: ReportTarget, id: string) {
  if (type === 'post') await db.delete(schema.posts).where(eq(schema.posts.id, id));
  if (type === 'comment') await db.delete(schema.comments).where(eq(schema.comments.id, id));
  if (type === 'story') await db.delete(schema.stories).where(eq(schema.stories.id, id));
  if (type === 'message') await db.delete(schema.messages).where(eq(schema.messages.id, id));
}

/** Bloque : retire l'amitié (et les demandes) dans les deux sens. */
export async function block(me: AuthUser, otherId: string) {
  await db.insert(blocks).values({ blockerId: me.id, blockedId: otherId }).onConflictDoNothing();
  await db
    .delete(friendships)
    .where(
      or(
        and(eq(friendships.requesterId, me.id), eq(friendships.addresseeId, otherId)),
        and(eq(friendships.requesterId, otherId), eq(friendships.addresseeId, me.id)),
      ),
    );
  await db
    .delete(schema.notifications)
    .where(
      or(
        and(eq(schema.notifications.userId, me.id), eq(schema.notifications.actorId, otherId)),
        and(eq(schema.notifications.userId, otherId), eq(schema.notifications.actorId, me.id)),
      ),
    );
  await emitBadges(me.id);
  await emitBadges(otherId);
}

export default async function socialRoutes(app: FastifyInstance) {
  // ——— Recherche ———

  app.get('/api/search', async (req): Promise<PostSearch> => {
    const me = requireUser(req);
    const raw = String((req.query as { q?: string }).q ?? '').trim().slice(0, 60);
    const page = Math.max(0, Number((req.query as { page?: string }).page ?? 0) || 0);
    if (raw.replace(/^#/, '').length < 2) return { posts: [], users: [] };
    const circle = uuidArray([me.id, ...(await friendIds(me.id))]);
    const visible = sql`(p.author_id = any(${circle}) or p.kind = 'meme')`;

    if (raw.startsWith('#')) {
      const tag = raw.slice(1).toLowerCase().replace(/[^\p{L}\p{N}_]/gu, '');
      // Hashtag entier : « #ete » ne trouve pas « #ete2026 ».
      const pattern = `(^|[^[:alnum:]_&])#${tag}([^[:alnum:]_]|$)`;
      const posts = await selectPosts(me.id, { where: sql`${visible} and p.text ~* ${pattern}`, limit: 20, offset: page * 20 });
      return { posts, users: [] };
    }

    const like = `%${raw.replace(/[%_\\]/g, '')}%`;
    const posts = await selectPosts(me.id, {
      where: sql`${visible} and (p.text ilike ${like} or exists (select 1 from poll_options o where o.post_id = p.id and o.label ilike ${like}))`,
      limit: 20,
      offset: page * 20,
    });
    let found: PostSearch['users'] = [];
    if (page === 0) {
      const rows = await db.execute<{ id: string; username: string; displayName: string; avatarMediaId: string | null }>(sql`
        select u.id, u.username, u.display_name as "displayName", u.avatar_media_id as "avatarMediaId"
        from users u
        where u.id <> ${me.id} and u.suspended_at is null and (u.username ilike ${like} or u.display_name ilike ${like})
          and ${notBlocked(me.id, sql`u.id`)}
        order by (u.id = any(${circle})) desc, u.display_name
        limit 8`);
      found = [...rows].map(toLite);
    }
    return { posts, users: found };
  });

  /** « Tu les connais peut-être ? » : amis de mes amis, par nombre d'amis en commun. */
  app.get('/api/friends/suggestions', async (req): Promise<FriendSuggestion[]> => {
    const me = requireUser(req);
    const rows = await db.execute<{ id: string; mutual: number; via: string[] }>(sql`
      with mine as (
        select case when requester_id = ${me.id} then addressee_id else requester_id end as id
        from friendships where status = 'accepted' and (requester_id = ${me.id} or addressee_id = ${me.id})
      ),
      fof as (
        select case when f.requester_id = mine.id then f.addressee_id else f.requester_id end as id, mine.id as via
        from friendships f join mine on (f.requester_id = mine.id or f.addressee_id = mine.id)
        where f.status = 'accepted'
      )
      select fof.id, count(distinct fof.via)::int as mutual, array_agg(distinct fof.via) as via
      from fof join users u on u.id = fof.id
      where fof.id <> ${me.id} and u.suspended_at is null
        and not exists (select 1 from friendships x where (x.requester_id = ${me.id} and x.addressee_id = fof.id) or (x.requester_id = fof.id and x.addressee_id = ${me.id}))
        and ${notBlocked(me.id, sql`fof.id`)}
      group by fof.id
      order by mutual desc, max(u.created_at) desc
      limit 12`);
    const list = [...rows];
    const people = await usersByIds(list.flatMap((r) => [r.id, ...r.via]));
    return list
      .filter((r) => people.has(r.id))
      .map((r) => ({
        user: people.get(r.id)!,
        mutual: r.mutual,
        via: r.via.slice(0, 2).map((id) => people.get(id)?.displayName.split(' ')[0] ?? '').filter(Boolean),
      }));
  });

  // ——— Blocage ———

  app.post('/api/users/:id/block', async (req) => {
    const me = requireUser(req);
    const id = uuidParam(req.params);
    if (id === me.id) fail(400, 'Tu ne peux pas te bloquer toi-même');
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (!u) fail(404, 'Utilisateur introuvable');
    await block(me, id);
    return { ok: true };
  });

  app.delete('/api/users/:id/block', async (req) => {
    const me = requireUser(req);
    await db.delete(blocks).where(and(eq(blocks.blockerId, me.id), eq(blocks.blockedId, uuidParam(req.params))));
    return { ok: true };
  });

  app.get('/api/me/blocks', async (req): Promise<BlockedUser[]> => {
    const me = requireUser(req);
    const rows = await db.select().from(blocks).where(eq(blocks.blockerId, me.id)).orderBy(desc(blocks.createdAt));
    const people = await usersByIds(rows.map((r) => r.blockedId));
    return rows.filter((r) => people.has(r.blockedId)).map((r) => ({ ...people.get(r.blockedId)!, blockedAt: r.createdAt.toISOString() }));
  });

  // ——— Signalements ———

  app.post('/api/reports', perMinute(10), async (req) => {
    const me = requireUser(req);
    const body = parse(
      z.object({
        targetType: z.enum(['post', 'comment', 'story', 'message', 'user']),
        targetId: z.string().uuid(),
        reason: z.enum(REPORT_REASONS),
        block: z.boolean().optional(),
      }),
      req.body,
    );
    const target = await describe(body.targetType, body.targetId);
    if (!target) fail(404, 'Contenu introuvable');
    if (target!.authorId === me.id) fail(400, 'Tu ne peux pas signaler ton propre contenu');
    const inserted = await db
      .insert(reports)
      .values({ reporterId: me.id, targetType: body.targetType, targetId: body.targetId, reason: body.reason })
      .onConflictDoNothing()
      .returning();
    if (body.block) await block(me, target!.authorId);
    if (!inserted.length) return { ok: true, hidden: target!.hidden };

    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(reports)
      .where(and(eq(reports.targetType, body.targetType), eq(reports.targetId, body.targetId), isNull(reports.resolvedAt)));
    const hide = n >= REPORT_HIDE_THRESHOLD && body.targetType !== 'user' && body.targetType !== 'message';
    if (hide) await setHidden(body.targetType, body.targetId, true);
    const admins = await db.select({ id: users.id }).from(users).where(eq(users.isAdmin, true));
    sendPush(
      admins.map((a) => a.id).filter((id) => id !== me.id),
      { title: 'Nouveau signalement', body: `${body.reason}${hide ? ' · contenu masqué' : ''}`, url: '/moderation', tag: 'moderation' },
    ).catch(() => {});
    return { ok: true, hidden: hide };
  });

  // ——— Modération (admin) ———

  app.get('/api/admin/moderation', async (req): Promise<ModerationCase[]> => {
    requireAdmin(req);
    const rows = await db.execute<{ targetType: ReportTarget; targetId: string; n: number; reasons: string[]; reporters: string[]; first: Date }>(sql`
      select target_type as "targetType", target_id as "targetId", count(*)::int as n,
        array_agg(distinct reason) as reasons, array_agg(reporter_id) as reporters, min(created_at) as first
      from reports where resolved_at is null
      group by target_type, target_id
      order by count(*) desc, min(created_at) asc
      limit 100`);
    const cases: ModerationCase[] = [];
    const list = [...rows];
    const people = await usersByIds(list.flatMap((r) => r.reporters));
    for (const r of list) {
      const t = await describe(r.targetType, r.targetId);
      if (!t) {
        await db.update(reports).set({ resolvedAt: new Date() }).where(and(eq(reports.targetType, r.targetType), eq(reports.targetId, r.targetId)));
        continue;
      }
      const [author] = await db.select().from(users).where(eq(users.id, t.authorId)).limit(1);
      cases.push({
        targetType: r.targetType,
        targetId: r.targetId,
        reports: r.n,
        reasons: r.reasons,
        reporters: r.reporters.map((id) => people.get(id)).filter((u) => !!u),
        author: author ? toLite(author) : null,
        text: t.text,
        media: t.media,
        url: t.url,
        hidden: t.hidden,
        authorSuspended: !!author?.suspendedAt,
        createdAt: new Date(r.first).toISOString(),
      });
    }
    return cases;
  });

  app.post('/api/admin/moderation/resolve', async (req) => {
    requireAdmin(req);
    const body = parse(
      z.object({
        targetType: z.enum(['post', 'comment', 'story', 'message', 'user']),
        targetId: z.string().uuid(),
        action: z.enum(['dismiss', 'hide', 'delete']),
      }),
      req.body,
    );
    if (body.action === 'dismiss') await setHidden(body.targetType, body.targetId, false);
    if (body.action === 'hide') await setHidden(body.targetType, body.targetId, true);
    if (body.action === 'delete') await deleteTarget(body.targetType, body.targetId);
    await db
      .update(reports)
      .set({ resolvedAt: new Date() })
      .where(and(eq(reports.targetType, body.targetType), eq(reports.targetId, body.targetId), isNull(reports.resolvedAt)));
    return { ok: true };
  });

  /** Lien de réinitialisation du mot de passe (1 h, usage unique), à transmettre à la personne. */
  app.post('/api/admin/users/:id/reset-link', async (req) => {
    requireAdmin(req);
    const id = uuidParam(req.params);
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (!u) fail(404, 'Utilisateur introuvable');
    const token = randomToken();
    const expiresAt = new Date(Date.now() + 3600_000);
    await db.insert(schema.passwordResets).values({ id: sha256(token), userId: id, expiresAt });
    return { link: `${env.appUrl}/reinitialiser?token=${token}`, expiresAt: expiresAt.toISOString() };
  });

  /** Suspendre un compte : connexion refusée et sessions fermées. */
  app.post('/api/admin/users/:id/suspend', async (req) => {
    const me = requireAdmin(req);
    const id = uuidParam(req.params);
    if (id === me.id) fail(400, 'Tu ne peux pas te suspendre toi-même');
    await db.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, id));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
    return { ok: true };
  });

  app.delete('/api/admin/users/:id/suspend', async (req) => {
    requireAdmin(req);
    await db.update(users).set({ suspendedAt: null }).where(eq(users.id, uuidParam(req.params)));
    return { ok: true };
  });
}
