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
    // Vote commun : un mème à la fois, le même pour les deux ; chacun note celui de l'autre.
    for (let round = 0; round < 2; round++) {
      const v = state[mathis.username]!.vote!;
      expect(state[lea.username]!.vote!.meme.id).toBe(v.meme.id);
      expect(v.total).toBe(2);
      if (v.meme.author.id === lea.id) await emit(a, 'game:rate', v.meme.id, 2);
      else await emit(b, 'game:rate', v.meme.id, 1);
      await wait(1500);
    }
    const results = state[mathis.username]!;
    expect(results.stage).toBe('results');
    expect(results.winner?.caption).toBe('Moi le lundi matin');
    expect(results.players.find((p) => p.user.id === lea.id)?.score).toBe(100);

    expect((await emit(b, 'game:publish')).ok).toBe(true);
    const memes = await call(lea, 'GET', '/api/memes');
    expect(memes.body.items[0].text).toBe('Moi le lundi matin');
  });
});

describe('vote commun et légendes attendues', () => {
  it('attend un joueur déconnecté pour les légendes, puis fait voter tout le monde sur le même mème', async () => {
    const { voteTiming } = await import('../src/realtime/game.js');
    voteTiming.pauseMs = 50;
    const maya = await makeUser('maya');
    const noe = await makeUser('noe');
    const zoe = await makeUser('zoe');
    const a = await connect(maya);
    const b = await connect(noe);
    let c = await connect(zoe);
    const code = (await emit<GameRoom>(a, 'game:create')).data!.code;
    await emit(b, 'game:join', code);
    await emit(c, 'game:join', code);
    await emit(a, 'game:start');
    await wait(200);
    // Zoé verrouille son téléphone : son socket tombe, elle reste dans le salon.
    c.disconnect();
    await wait(100);
    await emit(a, 'game:caption', 'Légende A');
    await emit(b, 'game:caption', 'Légende B');
    await wait(200);
    expect(state[maya.username]?.stage).toBe('caption');
    // Elle revient et écrit la sienne : les trois légendes partent au vote.
    c = await connect(zoe);
    await wait(150);
    await emit(c, 'game:caption', 'Légende Z');
    await wait(200);
    const v1 = state[maya.username]!.vote!;
    expect(state[maya.username]!.stage).toBe('vote');
    expect(v1).toMatchObject({ index: 1, total: 3, voters: 2, voted: 0 });
    expect(state[noe.username]!.vote!.meme.id).toBe(v1.meme.id);
    expect(state[zoe.username]!.vote!.meme.id).toBe(v1.meme.id);
    const sockets = { [maya.id]: a, [noe.id]: b, [zoe.id]: c };
    const voters = [maya, noe, zoe].filter((u) => u.id !== v1.meme.author.id);
    // Un seul a voté : on reste sur le même mème.
    expect((await emit(sockets[voters[0].id], 'game:rate', v1.meme.id, 1)).ok).toBe(true);
    await wait(150);
    expect(state[maya.username]!.vote).toMatchObject({ index: 1, voted: 1, voters: 2 });
    // Voter pour un autre mème que celui affiché : refusé.
    expect((await emit(sockets[voters[1].id], 'game:rate', 'pas-ce-meme', 1)).error).toMatch(/plus au vote/);
    await emit(sockets[voters[1].id], 'game:rate', v1.meme.id, 2);
    await wait(250);
    expect(state[noe.username]!.vote).toMatchObject({ index: 2, voted: 0 });
    // Personne ne vote : à la fin du temps, mème suivant puis résultats.
    voteTiming.memeMs = 200;
    const v2 = state[maya.username]!.vote!;
    const voter = [maya, noe, zoe].find((u) => u.id !== v2.meme.author.id)!;
    await emit(sockets[voter.id], 'game:rate', v2.meme.id, 0);
    await wait(150);
    const other = [maya, noe, zoe].find((u) => u.id !== v2.meme.author.id && u.id !== voter.id)!;
    await emit(sockets[other.id], 'game:rate', v2.meme.id, 0);
    await wait(800);
    expect(state[maya.username]!.stage).toBe('results');
    expect(state[maya.username]!.memes).toHaveLength(3);
    voteTiming.memeMs = 15_000;
    voteTiming.pauseMs = 1200;
  });
});
