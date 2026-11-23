import { DAY_SHORT, type PelliculeState, type Shot, type UnpackState } from '@mandrix/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db, schema } from '../db/index.js';
import { requireUser } from '../lib/auth.js';
import { fail, uuidParam } from '../lib/http.js';
import { mediaRef, saveUpload } from '../lib/media.js';
import { notify } from '../lib/notify.js';
import { streakFor } from '../lib/streak.js';
import { usersByIds } from '../lib/users.js';
import { mondayIndex, nextReveal, weekLabel } from '../lib/week.js';

const { shots, shotLikes } = schema;
const DAY_LONG = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

async function batchCounts(revealAt: Date) {
  const [r] = await db.execute<{ count: number; people: number }>(sql`
    select count(*)::int as count, count(distinct user_id)::int as people from shots where reveal_at = ${revealAt.toISOString()}::timestamptz`);
  return r ?? { count: 0, people: 0 };
}

async function pelliculeState(userId: string): Promise<PelliculeState> {
  const next = nextReveal();
  const mine = await db
    .select({ takenAt: shots.takenAt })
    .from(shots)
    .where(and(eq(shots.userId, userId), eq(shots.revealAt, next)));
  const days = [0, 0, 0, 0, 0, 0, 0];
  for (const s of mine) days[mondayIndex(s.takenAt)]++;
  return {
    nextRevealAt: next.toISOString(),
    weekLabel: weekLabel(next),
    mine: { total: mine.length, days },
    current: await batchCounts(next),
    streak: await streakFor(userId),
  };
}

export default async function pelliculeRoutes(app: FastifyInstance) {
  app.get('/api/pellicule', async (req) => pelliculeState(requireUser(req).id));

  app.post('/api/pellicule/shots', async (req) => {
    const me = requireUser(req);
    const file = await req.file();
    if (!file) return fail(400, 'Aucune photo reçue');
    const revealAt = nextReveal();
    // La photo est scellée : personne (pas même son auteur) ne peut la voir avant le déballage.
    const m = await saveUpload(file, me.id, { accept: 'image', sealedUntil: revealAt });
    await db.insert(shots).values({ userId: me.id, mediaId: m.id, revealAt });
    return pelliculeState(me.id);
  });

  app.get('/api/pellicule/unpack', async (req): Promise<UnpackState> => {
    const me = requireUser(req);
    const next = nextReveal();
    const current = { ...(await batchCounts(next)), weekLabel: weekLabel(next) };
    const [last] = await db.execute<{ r: Date | null }>(sql`select max(reveal_at) as r from shots where reveal_at <= now()`);
    if (!last?.r) return { nextRevealAt: next.toISOString(), current, revealed: null };

    const revealAt = new Date(last.r);
    const rows = await db.execute<{ id: string; userId: string; takenAt: Date; mediaId: string; kind: string; width: number | null; height: number | null; likes: number; liked: boolean; pool: 'public' | 'friends' | null }>(sql`
      select s.id, s.user_id as "userId", s.taken_at as "takenAt", m.id as "mediaId", m.kind, m.width, m.height,
        (select count(*)::int from shot_likes l where l.shot_id = s.id) as likes,
        exists(select 1 from shot_likes l where l.shot_id = s.id and l.user_id = ${me.id}) as liked,
        (select pi.scope from pool_items pi where pi.media_id = s.media_id and pi.status = 'active') as pool
      from shots s join media m on m.id = s.media_id
      where s.reveal_at = ${revealAt.toISOString()}::timestamptz
      order by s.taken_at asc limit 500`);
    const list = [...rows];
    const authors = await usersByIds(list.map((r) => r.userId));
    const photos: Shot[] = list.map((r) => {
      const t = new Date(r.takenAt);
      return {
        id: r.id,
        media: mediaRef({ id: r.mediaId, kind: r.kind, width: r.width, height: r.height })!,
        author: authors.get(r.userId)!,
        day: DAY_SHORT[t.getDay()],
        takenAt: t.toISOString(),
        likes: r.likes,
        liked: r.liked,
        pool: r.pool,
      };
    });
    const perDay = new Map<number, number>();
    for (const p of photos) {
      const d = new Date(p.takenAt).getDay();
      perDay.set(d, (perDay.get(d) ?? 0) + 1);
    }
    const busiest = [...perDay.entries()].sort((a, b) => b[1] - a[1])[0];
    const counts = await batchCounts(revealAt);
    return {
      nextRevealAt: next.toISOString(),
      current,
      revealed: {
        revealAt: revealAt.toISOString(),
        weekLabel: weekLabel(revealAt),
        count: counts.count,
        people: counts.people,
        busiestDay: busiest ? DAY_LONG[busiest[0]] : null,
        photos,
        top: [...photos].sort((a, b) => b.likes - a.likes || a.takenAt.localeCompare(b.takenAt)).slice(0, 3),
      },
    };
  });

  app.put('/api/pellicule/shots/:id/like', async (req) => {
    const me = requireUser(req);
    const id = uuidParam(req.params);
    const [s] = await db.select().from(shots).where(eq(shots.id, id)).limit(1);
    if (!s || s.revealAt > new Date()) return fail(404, 'Photo introuvable');
    const ins = await db.insert(shotLikes).values({ shotId: id, userId: me.id }).onConflictDoNothing().returning();
    if (ins.length) await notify({ userId: s.userId, type: 'shot_like', actorId: me.id, data: { shotId: id }, dedupeKey: `shot_like:${id}:${me.id}` });
    return { ok: true };
  });

  app.delete('/api/pellicule/shots/:id/like', async (req) => {
    const me = requireUser(req);
    const id = uuidParam(req.params);
    await db.delete(shotLikes).where(and(eq(shotLikes.shotId, id), eq(shotLikes.userId, me.id)));
    return { ok: true };
  });
}
