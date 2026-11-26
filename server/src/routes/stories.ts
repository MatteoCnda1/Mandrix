import { MUSIC_CLIP_LENGTHS, videoTooLong, type StoryGroup, type StoryMusic, type StoryView } from '@mandrix/shared';
import { plexEnabled, saveStoryClip } from '../lib/plex.js';
import type { StoryMusicInfo } from '../db/schema.js';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
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
    const rows = await db.execute<{ id: string; authorId: string; createdAt: Date; mediaId: string; kind: string; width: number | null; height: number | null; mediaDuration: number | null; mediaPoster: boolean; mediaVariants: number[] | null; seen: boolean; views: number | null; pool: 'public' | 'friends' | null; musicMediaId: string | null; music: StoryMusicInfo | null }>(sql`
      select s.id, s.author_id as "authorId", s.created_at as "createdAt", m.id as "mediaId", m.kind, m.width, m.height, ${sql.raw(MEDIA_SQL_COLUMNS)},
        exists(select 1 from story_views v where v.story_id = s.id and v.viewer_id = ${me.id}) as seen,
        case when s.author_id = ${me.id} then (select count(*)::int from story_views v where v.story_id = s.id and v.viewer_id <> ${me.id}) end as views,
        (select pi.scope from pool_items pi where pi.media_id = s.media_id and pi.status = 'active') as pool,
        s.music_media_id as "musicMediaId", s.music
      from stories s join media m on m.id = s.media_id
      where s.expires_at > now() and m.status <> 'processing' and s.author_id = any(${uuidArray(circle)}) and s.hidden_at is null
      order by s.created_at asc`);
    const list = [...rows];
    const authors = await usersByIds(list.map((r) => r.authorId), me.id);
    // Extraits et pochettes des stories en musique.
    const extra = list.flatMap((r) => [r.musicMediaId, r.music?.coverMediaId ?? null]).filter((x): x is string => !!x);
    const files = new Map((extra.length ? await db.select().from(media).where(inArray(media.id, extra)) : []).map((x) => [x.id, mediaRef(x)!]));
    const musicOf = (r: (typeof list)[number]): StoryMusic | null => {
      const clip = r.musicMediaId ? files.get(r.musicMediaId) : undefined;
      if (!r.music || !clip) return null;
      return { title: r.music.title, artist: r.music.artist, cover: (r.music.coverMediaId && files.get(r.music.coverMediaId)) || null, clip, duration: r.music.duration };
    };
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
        music: musicOf(r),
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
    const { mediaId, music } = parse(
      z.object({
        mediaId: z.string().uuid('Média invalide'),
        /** Musique (photo seulement) : titre Plex et passage choisi. */
        music: z
          .object({
            trackId: z.string().regex(/^\d{1,12}$/, 'Titre invalide'),
            start: z.number().min(0).max(24 * 3600),
            duration: z.number().refine((n) => (MUSIC_CLIP_LENGTHS as readonly number[]).includes(n), 'Durée d’extrait invalide'),
          })
          .optional(),
      }),
      req.body,
    );
    const [m] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
    if (!m || m.ownerId !== me.id) fail(404, 'Média introuvable');
    if (m!.kind === 'audio') fail(400, 'Une story est une photo ou une vidéo');
    const tooLong = m!.kind === 'video' ? videoTooLong(m!.duration, 'story') : null;
    if (tooLong) fail(400, tooLong);
    if (music && m!.kind !== 'image') fail(400, 'La musique se met sur une story photo (une vidéo a déjà son son)');
    if (music && !plexEnabled()) fail(503, 'Bibliothèque musicale indisponible');
    // Passage découpé et rangé dans Mandrix : la story se lit même si Plex est éteint.
    const clip = music ? await saveStoryClip(me.id, music.trackId, music.start, music.duration) : null;
    const [s] = await db
      .insert(stories)
      .values({ authorId: me.id, mediaId, expiresAt: new Date(Date.now() + 24 * 3600_000), musicMediaId: clip?.clip.id ?? null, music: clip?.music ?? null })
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
