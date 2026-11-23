import type { Ack } from '@mandrix/shared';
import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { env } from '../env.js';
import { parseCookieHeader, SESSION_COOKIE, userFromToken } from '../lib/auth.js';
import { HttpError } from '../lib/http.js';
import { relayTyping } from '../routes/messages.js';
import * as game from './game.js';
import { setIO, type IO } from './io.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrap(ack: Ack<any> | undefined, fn: () => unknown) {
  Promise.resolve()
    .then(fn)
    .then(
      (data) => ack?.({ ok: true, data: data ?? undefined }),
      (err) => {
        if (!(err instanceof HttpError)) console.error('[socket]', err);
        ack?.({ ok: false, error: err instanceof HttpError ? err.message : 'Erreur inattendue' });
      },
    );
}

export function attachSocket(app: FastifyInstance) {
  const io: IO = new Server(app.server, {
    path: '/socket.io',
    serveClient: false,
    // Même origine uniquement : on refuse les connexions venant d'un autre site.
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      if (!origin) return cb(null, true);
      // Derrière Cloudflare Tunnel, l'hôte peut être réécrit : on accepte aussi APP_URL.
      const allowed = new Set([req.headers.host, req.headers['x-forwarded-host'], new URL(env.appUrl).host].filter(Boolean));
      try {
        cb(null, allowed.has(new URL(origin).host));
      } catch {
        cb(null, false);
      }
    },
  });
  setIO(io);

  io.use(async (socket, next) => {
    const token = parseCookieHeader(socket.handshake.headers.cookie, SESSION_COOKIE);
    const user = await userFromToken(token).catch(() => null);
    if (!user) return next(new Error('unauthorized'));
    socket.data.userId = user.id;
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    socket.join(`u:${userId}`);
    game.onConnect(userId, socket.id);

    socket.on('game:create', (ack) => wrap(ack, () => game.createRoom(userId)));
    socket.on('game:join', (code, ack) => wrap(ack, () => game.joinRoom(userId, code)));
    socket.on('game:leave', (ack) => wrap(ack, () => game.leaveRoom(userId)));
    socket.on('game:sync', (ack) => wrap(ack, () => game.syncRoom(userId)));
    socket.on('game:settings', (s, ack) => wrap(ack, () => game.updateSettings(userId, s ?? {})));
    socket.on('game:start', (ack) => wrap(ack, () => game.startGame(userId)));
    socket.on('game:shuffle', (ack) => wrap(ack, () => game.shuffle(userId)));
    socket.on('game:report', (ack) => wrap(ack, () => game.report(userId)));
    socket.on('game:caption', (text, ack) => wrap(ack, () => game.submitCaption(userId, text)));
    socket.on('game:rate', (memeId, rating, ack) => wrap(ack, () => game.rate(userId, memeId, rating)));
    socket.on('game:next', (ack) => wrap(ack, () => game.next(userId)));
    socket.on('game:publish', (ack) => wrap(ack, async () => void (await game.publish(userId))));

    socket.on('dm:typing', (conversationId, typing) => {
      relayTyping(userId, conversationId, typing).catch(() => {});
    });

    socket.on('disconnect', () => game.onDisconnect(userId, socket.id));
  });

  return io;
}
