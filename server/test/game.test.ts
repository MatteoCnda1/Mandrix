import type { GameRoom } from '@mandrix/shared';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, befriend, call, jpeg, makeUser, upload, useApp, wait, type TestUser } from './helpers.js';

useApp();

let url = '';
let mathis: TestUser, lea: TestUser;
const sockets: Socket[] = [];
const state: Record<string, GameRoom | null> = {};

function connect(user: TestUser) {
  const s = io(url, { path: '/socket.io', transports: ['websocket'], extraHeaders: { cookie: user.cookie } });
  s.on('game:state', (r: GameRoom | null) => (state[user.username] = r));
  sockets.push(s);
  return new Promise<Socket>((resolve, reject) => {
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

const emit = <T = unknown>(s: Socket, event: string, ...args: unknown[]) =>
  new Promise<{ ok: boolean; data?: T; error?: string }>((resolve) => s.emit(event, ...args, resolve));

beforeAll(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  mathis = await makeUser('mathis');
  lea = await makeUser('lea');
  await befriend(mathis, lea);
  // Deux images dans le pool public pour pouvoir jouer.
  for (const color of ['#2A9DF4', '#FF8A5C']) {
    const m = await upload(lea, '/api/media', await jpeg(color));
    await call(lea, 'POST', '/api/posts', { kind: 'photo', mediaId: m.body.id, pool: 'public' });
  }
});

afterAll(() => sockets.forEach((s) => s.disconnect()));

describe('Make It Friends', () => {
  it('refuse une connexion temps réel sans session', async () => {
    const s = io(url, { path: '/socket.io', transports: ['websocket'], reconnection: false });
    const err = await new Promise<Error>((resolve) => s.on('connect_error', resolve));
    expect(err.message).toBe('unauthorized');
    s.disconnect();
  });

  it('joue une manche complète à deux', async () => {
    const a = await connect(mathis);
    const b = await connect(lea);

    const created = await emit<GameRoom>(a, 'game:create');
    expect(created.ok).toBe(true);
    const code = created.data!.code;
    expect(code).toMatch(/^MDRX-\d{3}$/);
    // Le créateur reçoit aussi l'état du salon en temps réel (l'écran s'appuie dessus).
    await wait(100);
    expect(state[mathis.username]?.code).toBe(code);
    expect(state[mathis.username]?.stage).toBe('lobby');

    // Le code se tape aussi sans préfixe.
    expect((await emit(b, 'game:join', code.slice(5))).ok).toBe(true);
    expect((await emit(b, 'game:start')).error).toMatch(/hôte/);
    expect((await emit(a, 'game:start')).ok).toBe(true);
    await wait(200);
    expect(state[mathis.username]?.stage).toBe('caption');
    expect(state[mathis.username]?.me.image).not.toBeNull();

    await emit(a, 'game:caption', 'Quand le frigo s’ouvre à 3h');
    await emit(b, 'game:caption', 'Moi le lundi matin');
    await wait(200);
    expect(state[mathis.username]?.stage).toBe('vote');
    const toRate = state[mathis.username]!.memes;
    expect(toRate).toHaveLength(1);
    expect(toRate[0].author.id).toBe(lea.id);

    await emit(a, 'game:rate', toRate[0].id, 2);
    await emit(b, 'game:rate', state[lea.username]!.memes[0].id, 1);
    await wait(300);
    const results = state[mathis.username]!;
    expect(results.stage).toBe('results');
    expect(results.winner?.caption).toBe('Moi le lundi matin');
    expect(results.players.find((p) => p.user.id === lea.id)?.score).toBe(100);

    expect((await emit(b, 'game:publish')).ok).toBe(true);
    const memes = await call(lea, 'GET', '/api/memes');
    expect(memes.body.items[0].text).toBe('Moi le lundi matin');
  });
});
