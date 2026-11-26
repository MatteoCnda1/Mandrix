import type { MusicTrack } from '@mandrix/shared';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../lib/auth.js';
import { perMinute } from '../lib/limits.js';
import { plexEnabled, previewClip, searchTracks, trackCover } from '../lib/plex.js';
import { fail } from '../lib/http.js';

/** Musique des stories : recherche dans Plex, pochettes, extraits d'écoute pour choisir le passage. */
export default async function musicRoutes(app: FastifyInstance) {
  app.get('/api/music/search', perMinute(60), async (req): Promise<MusicTrack[]> => {
    requireUser(req);
    if (!plexEnabled()) fail(503, 'Bibliothèque musicale indisponible');
    return searchTracks(String((req.query as { q?: string }).q ?? ''));
  });

  app.get('/api/music/tracks/:id/cover', async (req, reply) => {
    requireUser(req);
    const { id } = req.params as { id: string };
    const img = await trackCover(id);
    return reply.header('Content-Type', 'image/webp').header('Cache-Control', 'private, max-age=86400').send(img);
  });

  app.get('/api/music/tracks/:id/preview', perMinute(90), async (req, reply) => {
    requireUser(req);
    const { id } = req.params as { id: string };
    const q = req.query as { start?: string; len?: string };
    const clip = await previewClip(id, Number(q.start) || 0, Number(q.len) || 15);
    return reply.header('Content-Type', 'audio/aac').header('Cache-Control', 'private, max-age=600').send(clip);
  });
}
