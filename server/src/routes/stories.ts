import type { StoryGroup } from '@mandrix/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireUser } from '../lib/auth.js';
import { fail, parse, uuidParam } from '../lib/http.js';
import { MEDIA_SQL_COLUMNS, mediaRef } from '../lib/media.js';
import { friendIds, usersByIds, uuidArray } from '../lib/users.js';

const { stories, storyViews, media } = schema;

export default async function storyRoutes(app: FastifyInstance) {
  app.get('/api/stories', async (req): Promise<StoryGroup[]> => {
    const me = requireUser(req);
    const circle = [me.id, ...(await friendIds(me.id))];
    const rows = await db.execute<{ id: string; authorId: string; createdAt: Date; mediaId: string; kind: string; width: number | null; height: number | null; mediaDuration: number | null; mediaPoster: boolean; mediaVariants: number[] | null; seen: boolean }>(sql`
      select s.id, s.author_id as "authorId", s.created_at as "createdAt", m.id as "mediaId", m.kind, m.width, m.height, ${sql.raw(MEDIA_SQL_COLUMNS)},
        exists(select 1 from story_views v where v.story_id = s.id and v.viewer_id = ${me.id}) as seen
      from stories s join media m on m.id = s.media_id
      where s.expires_at > now() and m.status <> 'processing' and s.author_id = any(${uuidArray(circle)}) and s.hidden_at is null
      order by s.created_at asc`);
    const list = [...rows];
    const authors = await usersByIds(list.map((r) => r.authorId));
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

  app.post('/api/stories', async (req) => {
    const me = requireUser(req);
    const { mediaId } = parse(z.object({ mediaId: z.string().uuid('Média invalide') }), req.body);
    const [m] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
    if (!m || m.ownerId !== me.id) fail(404, 'Média introuvable');
    if (m!.kind === 'audio') fail(400, 'Une story est une photo ou une vidéo');
    const [s] = await db
      .insert(stories)
      .values({ authorId: me.id, mediaId, expiresAt: new Date(Date.now() + 24 * 3600_000) })
      .returning();
    return { id: s.id };
  });

  app.post('/api/stories/:id/seen', async (req) => {
    const me = requireUser(req);
    const id = uuidParam(req.params);
    await db.insert(storyViews).values({ storyId: id, viewerId: me.id }).onConflictDoNothing();
    return { ok: true };
  });

  app.delete('/api/stories/:id', async (req) => {
    const me = requireUser(req);
    const id = uuidParam(req.params);
    await db.delete(stories).where(and(eq(stories.id, id), eq(stories.authorId, me.id)));
    return { ok: true };
  });
}
