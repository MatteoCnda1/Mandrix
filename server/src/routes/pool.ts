import type { PoolImage, PoolStats, ReportedItem } from '@mandrix/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireUser } from '../lib/auth.js';
import { fail, parse, uuidParam } from '../lib/http.js';
import { MEDIA_SQL_COLUMNS, mediaRef } from '../lib/media.js';
import { notify } from '../lib/notify.js';
import { friendIds, usersByIds, uuidArray } from '../lib/users.js';

const { poolItems, poolReports, posts, shots } = schema;

export async function upsertPoolItem(v: { mediaId: string; ownerId: string; addedById: string; scope: 'public' | 'friends' }) {
  await db
    .insert(poolItems)
    .values({ ...v, status: 'active' })
    .onConflictDoUpdate({
      target: poolItems.mediaId,
      // Un contenu signalé reste en attente de vérification.
      set: { scope: v.scope, addedById: v.addedById, status: sql`case when ${poolItems.status} = 'reported' then 'reported' else 'active' end` },
    });
}

async function resolveTarget(body: { postId?: string; shotId?: string }) {
  if (body.postId) {
    const [p] = await db.select().from(posts).where(eq(posts.id, body.postId)).limit(1);
    if (!p || !p.mediaId) return fail(404, 'Ce post ne contient pas de média');
    if (p.kind === 'meme') return fail(400, 'Ce mème vient déjà du pool');
    return { mediaId: p.mediaId, ownerId: p.authorId };
  }
  if (body.shotId) {
    const [s] = await db.select().from(shots).where(eq(shots.id, body.shotId)).limit(1);
    if (!s) return fail(404, 'Photo introuvable');
    if (s.revealAt > new Date()) return fail(403, 'Cette photo est encore scellée');
    return { mediaId: s.mediaId, ownerId: s.userId };
  }
  return fail(400, 'Contenu manquant');
}

const MILESTONES = new Set([1, 5, 10, 25, 50, 100, 250, 500, 1000]);

/** Tire des images au hasard dans le pool pour Make It Friends. */
export async function drawPool(opts: {
  count: number;
  source: 'public' | 'friends';
  playerIds: string[];
  hostId: string;
  exclude: string[];
}): Promise<PoolImage[]> {
  const pick = async (source: 'public' | 'friends') => {
    let filter = sql`pi.scope = 'public'`;
    if (source === 'friends') {
      const circle = new Set([...opts.playerIds, ...(await friendIds(opts.hostId))]);
      filter = sql`pi.owner_id = any(${uuidArray([...circle])})`;
    }
    return db.execute<{ id: string; mediaId: string; kind: string; width: number | null; height: number | null; mediaDuration: number | null; mediaPoster: boolean; mediaVariants: number[] | null; username: string; ownerId: string; draws: number }>(sql`
      select pi.id, pi.media_id as "mediaId", m.kind, m.width, m.height, ${sql.raw(MEDIA_SQL_COLUMNS)}, u.username, pi.owner_id as "ownerId", pi.draws
      from pool_items pi
      join media m on m.id = pi.media_id
      join users u on u.id = pi.owner_id
      where pi.status = 'active' and m.status <> 'processing' and (m.sealed_until is null or m.sealed_until <= now())
        and ${filter} and not (pi.id = any(${uuidArray(opts.exclude)}))
      order by random() limit ${opts.count}`);
  };
  let rows = [...(await pick(opts.source))];
  if (rows.length === 0 && opts.source === 'friends') rows = [...(await pick('public'))];

  for (const r of rows) {
    const draws = r.draws + 1;
    await db.update(poolItems).set({ draws: sql`${poolItems.draws} + 1` }).where(eq(poolItems.id, r.id));
    if (MILESTONES.has(draws)) {
      await notify({ userId: r.ownerId, type: 'pool_drawn', data: { count: draws, kind: r.kind }, dedupeKey: `pool_drawn:${r.id}` });
    }
  }
  return rows.map((r) => ({
    itemId: r.id,
    media: mediaRef({ id: r.mediaId, kind: r.kind, width: r.width, height: r.height, duration: r.mediaDuration, hasPoster: r.mediaPoster, variants: r.mediaVariants })!,
    by: `@${r.username}`,
  }));
}

export async function reportPoolItem(itemId: string, reporterId: string) {
  await db.insert(poolReports).values({ itemId, reporterId }).onConflictDoNothing();
  await db.update(poolItems).set({ status: 'reported' }).where(and(eq(poolItems.id, itemId), eq(poolItems.status, 'active')));
}

const targetSchema = z.object({ postId: z.string().uuid().optional(), shotId: z.string().uuid().optional() });

export default async function poolRoutes(app: FastifyInstance) {
  app.get('/api/pool/stats', async (req): Promise<PoolStats> => {
    const me = requireUser(req);
    const [r] = await db.execute<PoolStats & Record<string, unknown>>(sql`
      select
        (select count(*)::int from pool_items where status = 'active' and scope = 'public') as "publicCount",
        (select count(*)::int from pool_items where status = 'active' and owner_id = ${me.id}) as mine`);
    return r;
  });

  app.post('/api/pool', async (req) => {
    const me = requireUser(req);
    const body = parse(targetSchema.extend({ scope: z.enum(['public', 'friends']) }), req.body);
    const t = await resolveTarget(body);
    await upsertPoolItem({ mediaId: t.mediaId, ownerId: t.ownerId, addedById: me.id, scope: body.scope });
    if (t.ownerId !== me.id) {
      await notify({
        userId: t.ownerId,
        type: 'pool_added',
        actorId: me.id,
        data: { postId: body.postId ?? null, shotId: body.shotId ?? null },
        dedupeKey: `pool_added:${t.mediaId}`,
      });
    }
    const [row] = await db.select().from(poolItems).where(eq(poolItems.mediaId, t.mediaId));
    return { pool: row.status === 'active' ? row.scope : null };
  });

  app.post('/api/pool/remove', async (req) => {
    const me = requireUser(req);
    const body = parse(targetSchema, req.body);
    const t = await resolveTarget(body);
    const [row] = await db.select().from(poolItems).where(eq(poolItems.mediaId, t.mediaId)).limit(1);
    if (!row) return { pool: null };
    if (row.ownerId !== me.id && row.addedById !== me.id && !me.isAdmin) fail(403, 'Seul l’auteur peut retirer ce contenu du pool');
    await db.update(poolItems).set({ status: 'removed' }).where(eq(poolItems.id, row.id));
    return { pool: null };
  });

  // ——— Modération (admin) ———

  app.get('/api/admin/reports', async (req): Promise<ReportedItem[]> => {
    const me = requireUser(req);
    if (!me.isAdmin) fail(403, 'Réservé aux administrateurs');
    const rows = await db.execute<{ id: string; mediaId: string; kind: string; width: number | null; height: number | null; ownerId: string; reports: number; createdAt: Date }>(sql`
      select pi.id, pi.media_id as "mediaId", m.kind, m.width, m.height, pi.owner_id as "ownerId",
        (select count(*)::int from pool_reports r where r.item_id = pi.id) as reports, pi.created_at as "createdAt"
      from pool_items pi join media m on m.id = pi.media_id
      where pi.status = 'reported' order by pi.created_at desc limit 100`);
    const list = [...rows];
    const owners = await usersByIds(list.map((r) => r.ownerId));
    return list.map((r) => ({
      id: r.id,
      media: mediaRef({ id: r.mediaId, kind: r.kind, width: r.width, height: r.height })!,
      owner: owners.get(r.ownerId)!,
      reports: r.reports,
      createdAt: new Date(r.createdAt).toISOString(),
    }));
  });

  app.post('/api/admin/pool/:id/restore', async (req) => {
    const me = requireUser(req);
    if (!me.isAdmin) fail(403, 'Réservé aux administrateurs');
    const id = uuidParam(req.params);
    await db.update(poolItems).set({ status: 'active' }).where(eq(poolItems.id, id));
    await db.delete(poolReports).where(eq(poolReports.itemId, id));
    return { ok: true };
  });

  app.delete('/api/admin/pool/:id', async (req) => {
    const me = requireUser(req);
    if (!me.isAdmin) fail(403, 'Réservé aux administrateurs');
    const id = uuidParam(req.params);
    await db.update(poolItems).set({ status: 'removed' }).where(eq(poolItems.id, id));
    return { ok: true };
  });
}
