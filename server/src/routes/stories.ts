import { videoTooLong, type StoryGroup, type StoryView } from '@mandrix/shared';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireUser } from '../lib/auth.js';
import { fail, parse, uuidParam } from '../lib/http.js';
import { MEDIA_SQL_COLUMNS, mediaRef } from '../lib/media.js';
import { areFriends, friendIds, usersByIds, uuidArray } from '../lib/users.js';
import { perMinute } from '../lib/limits.js';

const { stories, storyViews, media } = schema;

export default async function storyRoutes(app: FastifyInstance) {
  app.get('/api/stories', async (req): Promise<StoryGroup[]> => {
    const me = requireUser(req);
    const circle = [me.id, ...(await friendIds(me.id))];
    const rows = await db.execute<{ id: string; authorId: string; createdAt: Date; mediaId: string; kind: string; width: number | null; height: number | null; mediaDuration: number | null; mediaPoster: boolean; mediaVariants: number[] | null; seen: boolean; views: number | null; pool: 'public' | 'friends' | null }>(sql`
      select s.id, s.author_id as "authorId", s.created_at as "createdAt", m.id as "mediaId", m.kind, m.width, m.height, ${sql.raw(MEDIA_SQL_COLUMNS)},
        exists(select 1 from story_views v where v.story_id = s.id and v.viewer_id = ${me.id}) as seen,
        case when s.author_id = ${me.id} then (select count(*)::int from story_views v where v.story_id = s.id and v.viewer_id <> ${me.id}) end as views,
        (select pi.scope from pool_items pi where pi.media_id = s.media_id and pi.status = 'active') as pool
      from stories s join media m on m.id = s.media_id
      where s.expires_at > now() and m.status <> 'processing' and s.author_id = any(${uuidArray(circle)}) and s.hidden_at is null
      order by s.created_at asc`);
    const list = [...rows];
    const authors = await usersByIds(list.map((r) => r.authorId), me.id);
    const groups = new Map<string, StoryGroup>();
    for (const r of list) {
      let g = groups.get(r.authorId);
      if (!g) {
        g = { user: authors.get(r.authorId)!, stories: [], allSeen: true };
        groups.set(r.authorId, g);
      }
      const seen = r.authorId === me.id || r.seen;
      g.stories.push({
        id: r.id,
        media: mediaRef({ id: r.mediaId, kind: r.kind, width: r.width, height: r.height, duration: r.mediaDuration, hasPoster: r.mediaPoster, variants: r.mediaVariants })!,
        createdAt: new Date(r.createdAt).toISOString(),
        seen,
        views: r.views,
        pool: r.pool,
      });
      if (!seen) g.allSeen = false;
    }
    const latest = (g: StoryGroup) => g.stories[g.stories.length - 1].createdAt;
    return [...groups.values()].sort((a, b) => {
      if (a.user.id === me.id) return -1;
      if (b.user.id === me.id) return 1;
      if (a.allSeen !== b.allSeen) return a.allSeen ? 1 : -1;
      return latest(b).localeCompare(latest(a));
    });
  });

  app.post('/api/stories', perMinute(10), async (req) => {
    const me = requireUser(req);
    const { mediaId } = parse(z.object({ mediaId: z.string().uuid('Média invalide') }), req.body);
    const [m] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
    if (!m || m.ownerId !== me.id) fail(404, 'Média introuvable');
    if (m!.kind === 'audio') fail(400, 'Une story est une photo ou une vidéo');
    const tooLong = m!.kind === 'video' ? videoTooLong(m!.duration, 'story') : null;
    if (tooLong) fail(400, tooLong);
    const [s] = await db
      .insert(stories)
      .values({ authorId: me.id, mediaId, expiresAt: new Date(Date.now() + 24 * 3600_000) })
      .returning();
    return { id: s.id };
  });

  app.post('/api/stories/:id/seen', async (req) => {
    const me = requireUser(req);
    const id = uuidParam(req.params);
    const [s] = await db.select({ authorId: stories.authorId }).from(stories).where(eq(stories.id, id)).limit(1);
    // Seules les stories de mon cercle comptent (et pas les miennes).
    if (!s || s.authorId === me.id || !(await areFriends(me.id, s.authorId))) return { ok: true };
    await db.insert(storyViews).values({ storyId: id, viewerId: me.id }).onConflictDoNothing();
    return { ok: true };
  });

  /** Qui a vu ma story, du plus récent au plus ancien. */
  app.get('/api/stories/:id/viewers', async (req): Promise<StoryView[]> => {
    const me = requireUser(req);
    const id = uuidParam(req.params);
    const [s] = await db.select({ authorId: stories.authorId }).from(stories).where(eq(stories.id, id)).limit(1);
    if (!s || s.authorId !== me.id) return fail(404, 'Story introuvable');
    const rows = await db
      .select({ viewerId: storyViews.viewerId, at: storyViews.viewedAt })
      .from(storyViews)
      .where(and(eq(storyViews.storyId, id), ne(storyViews.viewerId, me.id)))
      .orderBy(desc(storyViews.viewedAt));
    const people = await usersByIds(rows.map((r) => r.viewerId));
    return rows.filter((r) => people.has(r.viewerId)).map((r) => ({ user: people.get(r.viewerId)!, at: r.at.toISOString() }));
  });

  app.delete('/api/stories/:id', async (req) => {
    const me = requireUser(req);
    const id = uuidParam(req.params);
    await db.delete(stories).where(and(eq(stories.id, id), eq(stories.authorId, me.id)));
    return { ok: true };
  });
}
