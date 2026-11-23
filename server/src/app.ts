import fs from 'node:fs';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from './db/index.js';
import { env, mediaDir } from './env.js';
import { authHook } from './lib/auth.js';
import { HttpError } from './lib/http.js';
import { attachSocket } from './realtime/socket.js';
import authRoutes from './routes/auth.js';
import mediaRoutes from './routes/media.js';
import messageRoutes from './routes/messages.js';
import notificationRoutes from './routes/notifications.js';
import pelliculeRoutes from './routes/pellicule.js';
import poolRoutes from './routes/pool.js';
import postRoutes from './routes/posts.js';
import storyRoutes from './routes/stories.js';
import userRoutes from './routes/users.js';

/** Construit l'application (routes, temps réel) sans démarrer l'écoute ni les tâches planifiées. */
export async function buildApp(): Promise<FastifyInstance> {
  fs.mkdirSync(mediaDir, { recursive: true });
  const app = Fastify({
    logger: { level: env.isProd ? 'info' : env.isTest ? 'silent' : 'warn' },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 1 } });

  const hasWeb = fs.existsSync(env.webDist);
  // Sert la PWA compilée (et décore reply.sendFile, utilisé aussi pour les médias).
  await app.register(fastifyStatic, {
    root: hasWeb ? env.webDist : mediaDir,
    serve: hasWeb,
    wildcard: false,
    index: false,
    cacheControl: false,
    setHeaders: (res, filePath) => {
      if (filePath.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else res.setHeader('Cache-Control', 'no-cache');
    },
  });

  app.decorateRequest('user', null);
  app.addHook('onRequest', authHook);

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.message });
    const err = error as Error & { statusCode?: number };
    const status = err.statusCode ?? 500;
    if (status === 413) return reply.code(413).send({ error: `Fichier trop volumineux (max ${env.maxUploadMb} Mo)` });
    if (status === 429) return reply.code(429).send({ error: 'Trop de tentatives, réessaie dans une minute' });
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: status >= 500 ? 'Erreur serveur' : err.message });
  });

  app.get('/api/health', async () => {
    await sql`select 1`;
    return { ok: true };
  });

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(postRoutes);
  await app.register(storyRoutes);
  await app.register(poolRoutes);
  await app.register(pelliculeRoutes);
  await app.register(messageRoutes);
  await app.register(notificationRoutes);
  await app.register(mediaRoutes);

  // Routage côté client : toute URL inconnue hors API renvoie la PWA.
  app.setNotFoundHandler((req, reply) => {
    if ((req.method === 'GET' || req.method === 'HEAD') && hasWeb && !req.url.startsWith('/api/') && !req.url.startsWith('/media/')) {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html', env.webDist);
    }
    return reply.code(404).send({ error: 'Introuvable' });
  });

  attachSocket(app);
  return app;
}
