import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db, schema } from '../db/index.js';
import { mediaDir } from '../env.js';
import { isUuid } from '../lib/http.js';

export default async function mediaRoutes(app: FastifyInstance) {
  app.get('/media/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    if (!isUuid(id)) return reply.code(404).send({ error: 'Introuvable' });
    const [m] = await db.select().from(schema.media).where(eq(schema.media.id, id)).limit(1);
    // Une photo de la Pellicule reste invisible jusqu'au déballage.
    if (!m || (m.sealedUntil && m.sealedUntil > new Date())) return reply.code(404).send({ error: 'Introuvable' });
    // Fichier absent du stockage (partage NAS non monté, suppression manuelle…).
    if (!fs.existsSync(path.join(mediaDir, m.path))) return reply.code(404).send({ error: 'Fichier introuvable' });
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.type(m.mime).sendFile(m.path, mediaDir, { cacheControl: false });
  });
}
