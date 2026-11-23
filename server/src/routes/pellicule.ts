import path from 'node:path';
import type { Multipart, MultipartFile } from '@fastify/multipart';
import { DAY_SHORT, SHOT_UNDO_MINUTES, type PelliculeState, type Shot, type UnpackState } from '@mandrix/shared';
import archiver from 'archiver';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db, schema } from '../db/index.js';
import { mediaDir } from '../env.js';
import { requireUser } from '../lib/auth.js';
import { fail, uuidParam } from '../lib/http.js';
import { deleteMediaFile, mediaRef, saveUpload, variantPath } from '../lib/media.js';
import { activeMoment, isOnTime } from '../lib/moment.js';
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
  // Dernière photo encore annulable (prise il y a moins de quelques minutes, pas encore déballée).
  const [last] = await db
    .select({ id: shots.id, at: schema.media.createdAt })
    .from(shots)
    .innerJoin(schema.media, eq(schema.media.id, shots.mediaId))
    .where(and(eq(shots.userId, userId), eq(shots.revealAt, next), gt(schema.media.createdAt, new Date(Date.now() - SHOT_UNDO_MINUTES * 60_000))))
    .orderBy(desc(schema.media.createdAt))
    .limit(1);
  return {
    nextRevealAt: next.toISOString(),
    weekLabel: weekLabel(next),
    moment: await activeMoment(),
    mine: { total: mine.length, days },
    current: await batchCounts(next),
    streak: await streakFor(userId),
    undo: last ? { shotId: last.id, until: new Date(last.at.getTime() + SHOT_UNDO_MINUTES * 60_000).toISOString() } : null,
  };
}

export default async function pelliculeRoutes(app: FastifyInstance) {
  app.get('/api/pellicule', async (req) => pelliculeState(requireUser(req).id));

  app.post('/api/pellicule/shots', async (req) => {
    const me = requireUser(req);
    const file = await req.file();
    if (!file) return fail(400, 'Aucune photo reçue');
    const now = new Date();

    // Photo prise hors ligne et envoyée plus tard : on garde l'heure réelle de prise de vue (14 jours max).
    let takenAt = now;
    const raw = fieldValue(file, 'takenAt');
    if (raw) {
      const t = new Date(raw);
      if (!Number.isNaN(t.getTime()) && t.getTime() <= now.getTime() + 60_000 && now.getTime() - t.getTime() <= 14 * 86400_000) {
        takenAt = t > now ? now : t;
      }
    }
    // Semaine déjà déballée entre-temps : la photo rejoint la semaine en cours pour rester une surprise.
    let revealAt = nextReveal(takenAt);
    if (revealAt <= now) revealAt = nextReveal(now);

    // Un renvoi de la même photo (identifiant généré par l'appareil) ne crée pas de doublon.
    const clientId = fieldValue(file, 'clientId')?.slice(0, 64) || null;
    if (clientId) {
      const [dup] = await db
        .select({ id: shots.id })
        .from(shots)
        .where(and(eq(shots.userId, me.id), eq(shots.clientId, clientId)))
        .limit(1);
      if (dup) {
        file.file.resume();
        return pelliculeState(me.id);
      }
    }

    // La photo est scellée : personne (pas même son auteur) ne peut la voir avant le déballage.
    const m = await saveUpload(file, me.id, { accept: 'image', sealedUntil: revealAt });
    await db
      .insert(shots)
      .values({ userId: me.id, mediaId: m.id, takenAt, revealAt, clientId, onTime: await isOnTime(takenAt) })
      .onConflictDoNothing();
    return pelliculeState(me.id);
  });

  /** Album d'une semaine déballée, en zip (toutes les photos, ou seulement les siennes). */
  app.get('/api/pellicule/archive', async (req, reply) => {
    const me = requireUser(req);
    const q = req.query as { revealAt?: string; scope?: string };
    const revealAt = new Date(q.revealAt ?? '');
    if (Number.isNaN(revealAt.getTime())) return fail(400, 'Semaine inconnue');
    if (revealAt > new Date()) return fail(403, 'Cette semaine n’est pas encore déballée');
    const mineOnly = q.scope !== 'all';
    const rows = await db.execute<{ takenAt: Date; path: string; username: string }>(sql`
      select s.taken_at as "takenAt", m.path, u.username
      from shots s join media m on m.id = s.media_id join users u on u.id = s.user_id
      where s.reveal_at = ${revealAt.toISOString()}::timestamptz ${mineOnly ? sql`and s.user_id = ${me.id}` : sql``}
      order by s.taken_at asc`);
    const list = [...rows];
    if (list.length === 0) return fail(404, 'Aucune photo pour cette semaine');

    const label = weekLabel(revealAt).replace(/^Semaine du /, '').replace(/\s+/g, '-');
    const name = `mandrix-${mineOnly ? 'mes-photos' : 'album'}-${label}.zip`.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const zip = archiver('zip', { store: true });
    const pad = (n: number) => String(n).padStart(2, '0');
    list.forEach((r, i) => {
      const t = new Date(r.takenAt);
      const stamp = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}_${pad(t.getHours())}h${pad(t.getMinutes())}`;
      zip.file(path.join(mediaDir, r.path), { name: `${stamp}_${String(i + 1).padStart(3, '0')}_${r.username}${path.extname(r.path)}` });
    });
    void zip.finalize();
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${name}"`);
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(zip);
  });

  app.get('/api/pellicule/unpack', async (req): Promise<UnpackState> => {
    const me = requireUser(req);
    const next = nextReveal();
    const current = { ...(await batchCounts(next)), weekLabel: weekLabel(next) };
    const [last] = await db.execute<{ r: Date | null }>(sql`select max(reveal_at) as r from shots where reveal_at <= now()`);
    if (!last?.r) return { nextRevealAt: next.toISOString(), current, revealed: null };

    const revealAt = new Date(last.r);
    const rows = await db.execute<{ id: string; userId: string; takenAt: Date; mediaId: string; kind: string; width: number | null; height: number | null; likes: number; liked: boolean; pool: 'public' | 'friends' | null; onTime: boolean }>(sql`
      select s.id, s.user_id as "userId", s.taken_at as "takenAt", m.id as "mediaId", m.kind, m.width, m.height,
        (select count(*)::int from shot_likes l where l.shot_id = s.id) as likes,
        exists(select 1 from shot_likes l where l.shot_id = s.id and l.user_id = ${me.id}) as liked,
        s.on_time as "onTime",
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
        onTime: r.onTime,
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

  /** Annuler une photo prise par erreur, dans les minutes qui suivent. */
  app.delete('/api/pellicule/shots/:id', async (req) => {
    const me = requireUser(req);
    const id = uuidParam(req.params);
    const [row] = await db
      .select({ shot: shots, media: schema.media })
      .from(shots)
      .innerJoin(schema.media, eq(schema.media.id, shots.mediaId))
      .where(and(eq(shots.id, id), eq(shots.userId, me.id)))
      .limit(1);
    if (!row) return fail(404, 'Photo introuvable');
    if (row.media.createdAt.getTime() < Date.now() - SHOT_UNDO_MINUTES * 60_000 || row.shot.revealAt <= new Date()) {
      fail(409, `Une photo ne s’annule que dans les ${SHOT_UNDO_MINUTES} minutes qui suivent`);
    }
    await db.delete(schema.media).where(eq(schema.media.id, row.media.id)); // la photo part avec (cascade)
    for (const rel of [row.media.path, ...(row.media.variants ?? []).map((w) => variantPath(row.media.path, w))]) await deleteMediaFile(rel).catch(() => {});
    return pelliculeState(me.id);
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

function fieldValue(file: MultipartFile, name: string): string | undefined {
  const f = file.fields[name] as Multipart | Multipart[] | undefined;
  const one = Array.isArray(f) ? f[0] : f;
  return one && one.type === 'field' ? String(one.value) : undefined;
}
