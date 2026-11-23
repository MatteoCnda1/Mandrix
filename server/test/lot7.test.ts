import { retroYear, type GuessState, type Message, type RetroState, type SeasonState, type UnpackState, type WhoisQuestion, type WhoisRoom } from '@mandrix/shared';
import { sql } from 'drizzle-orm';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { longestStreak } from '../src/lib/retro.js';
import { whoisTiming } from '../src/realtime/whois.js';
import { app, befriend, call, jpeg, makeUser, multipart, upload, useApp, wait, type TestUser } from './helpers.js';

useApp();

let ana: TestUser, ben: TestUser, cleo: TestUser, dan: TestUser, eve: TestUser;

beforeAll(async () => {
  [ana, ben, cleo, dan, eve] = await Promise.all(['ana', 'ben', 'cleo', 'dan', 'eve'].map(makeUser));
  await befriend(ana, ben);
  await befriend(ana, cleo);
  await befriend(ben, cleo);
  // Le premier compte créé est admin : on fixe qui l'est (Ana).
  await db.execute(sql`update users set is_admin = (id = ${ana.id})`);
});

async function shoot(u: TestUser, color: string) {
  const mp = multipart({ clientId: `shot-${u.username}-${color}` }, await jpeg(color));
  const res = await app.inject({ method: 'POST', url: '/api/pellicule/shots', headers: { cookie: u.cookie, 'content-type': mp.contentType }, payload: mp.payload });
  expect(res.statusCode).toBe(200);
}

describe('Qui a pris ça ? (#88)', () => {
  beforeAll(async () => {
    for (const [u, colors] of [
      [ben, ['#111111', '#222222']],
      [cleo, ['#333333', '#444444']],
      [dan, ['#555555', '#666666']],
    ] as const) {
      for (const c of colors) await shoot(u, c);
    }
    // Dimanche passé : la semaine est déballée.
    // (À la seconde, comme les vrais dimanches 20 h.)
    await db.execute(sql`update shots set reveal_at = date_trunc('second', now()) - interval '1 hour'`);
    await db.execute(sql`update media set sealed_until = null`);
  });

  const authorOf = async (shotId: string) => [...(await db.execute<{ userId: string }>(sql`select user_id as "userId" from shots where id = ${shotId}`))][0].userId;

  it('cache le déballage tant que le quiz n’est ni fini ni passé', async () => {
    const unpack = (await call<UnpackState>(ana, 'GET', '/api/pellicule/unpack')).body;
    expect(unpack.revealed?.quiz).toBe('todo');
    expect(unpack.revealed?.photos).toEqual([]);
    expect(unpack.revealed?.count).toBe(6);
    const revealAt = unpack.revealed!.revealAt;
    expect((await call(ana, 'GET', `/api/pellicule/archive?revealAt=${encodeURIComponent(revealAt)}&scope=all`)).status).toBe(403);

    const quiz = (await call<GuessState>(ana, 'GET', '/api/pellicule/guess')).body;
    expect(quiz.status).toBe('todo');
    expect(quiz.items).toHaveLength(6);
    // Trois auteurs : trois visages, aucun auteur révélé.
    for (const item of quiz.items) {
      expect(item.options).toHaveLength(3);
      expect(item.answer).toBeNull();
    }
    // Stable d'un chargement à l'autre.
    expect((await call<GuessState>(ana, 'GET', '/api/pellicule/guess')).body.items.map((i) => i.shotId)).toEqual(quiz.items.map((i) => i.shotId));
  });

  it('compte les bonnes réponses, passe, puis ouvre le déballage', async () => {
    const quiz = (await call<GuessState>(ana, 'GET', '/api/pellicule/guess')).body;
    const [first, second] = quiz.items;
    const right = await authorOf(first.shotId);
    const after = (await call<GuessState>(ana, 'POST', '/api/pellicule/guess', { shotId: first.shotId, userId: right })).body;
    expect(after.items[0].answer?.id).toBe(right);
    expect(after.score).toBe(20);
    expect((await call(ana, 'POST', '/api/pellicule/guess', { shotId: first.shotId, userId: right })).status).toBe(409);
    expect((await call(ana, 'POST', '/api/pellicule/guess', { shotId: second.shotId, userId: eve.id })).status).toBe(400);
    const secondAuthor = await authorOf(second.shotId);
    const pick = second.options.find((o) => o.id !== secondAuthor)!.id;
    await call(ana, 'POST', '/api/pellicule/guess', { shotId: second.shotId, userId: pick });

    const skipped = (await call<GuessState>(ana, 'POST', '/api/pellicule/guess/skip')).body;
    expect(skipped.status).toBe('skipped');
    expect(skipped.score).toBe(20);
    expect(skipped.items.every((i) => i.answer)).toBe(true);
    const unpack = (await call<UnpackState>(ana, 'GET', '/api/pellicule/unpack')).body;
    expect(unpack.revealed?.quiz).toBe('skipped');
    expect(unpack.revealed?.photos).toHaveLength(6);
    expect((await call(ana, 'POST', '/api/pellicule/guess', { shotId: skipped.items[3].shotId, userId: skipped.items[3].options[0].id })).status).toBe(409);
  });

  it('un auteur devine les photos des autres ; ses points comptent pour la saison', async () => {
    const quiz = (await call<GuessState>(ben, 'GET', '/api/pellicule/guess')).body;
    expect(quiz.items).toHaveLength(4);
    expect(quiz.items.every((i) => i.options.every((o) => o.id !== ben.id))).toBe(true);
    let last: GuessState = quiz;
    for (const item of quiz.items) last = (await call<GuessState>(ben, 'POST', '/api/pellicule/guess', { shotId: item.shotId, userId: await authorOf(item.shotId) })).body;
    expect(last.status).toBe('done');
    expect(last.score).toBe(80);
    expect(last.ranking[0]).toMatchObject({ user: { id: ben.id }, score: 80, hits: 4 });
    const season = (await call<SeasonState>(cleo, 'GET', '/api/season')).body;
    expect(season.ranking.find((r) => r.user.id === ben.id)).toMatchObject({ points: 80, hits: 4 });
    expect(season.ranking.find((r) => r.user.id === ana.id)).toMatchObject({ points: 20, hits: 1 });
  });
});

describe('Qui de nous… ? (#89)', () => {
  let url = '';
  const sockets: Socket[] = [];
  const state: Record<string, WhoisRoom | null> = {};

  function connect(user: TestUser) {
    const s = io(url, { path: '/socket.io', transports: ['websocket'], extraHeaders: { cookie: user.cookie } });
    s.on('whois:state', (r: WhoisRoom | null) => (state[user.username] = r));
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
  });
  afterAll(() => sockets.forEach((s) => s.disconnect()));

  it('les questions de la bande se gardent et se partagent entre amis', async () => {
    const q = (await call<WhoisQuestion>(ana, 'POST', '/api/whois/questions', { text: 'Qui de nous mange le plus de fromage' })).body;
    expect(q.text).toBe('Qui de nous mange le plus de fromage ?');
    expect((await call(ana, 'POST', '/api/whois/questions', { text: 'Trop' })).status).toBe(400);
    expect((await call<WhoisQuestion[]>(ben, 'GET', '/api/whois/questions')).body.map((x) => x.id)).toContain(q.id);
    expect((await call<WhoisQuestion[]>(eve, 'GET', '/api/whois/questions')).body).toEqual([]);
    expect((await call(ben, 'DELETE', `/api/whois/questions/${q.id}`)).status).toBe(403);
    const keep = (await call<WhoisQuestion>(ana, 'POST', '/api/whois/questions', { text: 'Qui de nous chante sous la douche ?' })).body;
    expect((await call(ana, 'DELETE', `/api/whois/questions/${q.id}`)).status).toBe(200);
    expect((await call<WhoisQuestion[]>(ana, 'GET', '/api/whois/questions')).body.map((x) => x.id)).toEqual([keep.id]);
  });

  it('joue une partie à trois : votes, révélation, points et titres', async () => {
    const a = await connect(ana);
    const b = await connect(ben);
    const c = await connect(cleo);
    const created = await emit<WhoisRoom>(a, 'whois:create');
    const code = created.data!.code;
    expect(code).toMatch(/^QDN-\d{3}$/);
    expect(created.data!.customCount).toBe(1);
    await emit(b, 'whois:join', code.replace('QDN-', ''));
    expect((await emit(a, 'whois:start')).error).toMatch(/au moins 3/);
    await emit(c, 'whois:join', code);
    expect((await emit(b, 'whois:start')).ok).toBe(false); // pas l'hôte
    await emit(a, 'whois:settings', { rounds: 5 });
    expect((await emit(a, 'whois:start')).ok).toBe(true);
    await wait(80);
    expect(state[ana.username]?.stage).toBe('question');

    const seen: (string | null)[] = [];
    for (let round = 1; round <= 5; round++) {
      seen.push(state[ana.username]?.question?.by?.id ?? null);
      expect(state[ben.username]?.round).toBe(round);
      // Ben est désigné deux fois, Ana une fois.
      await emit(a, 'whois:vote', ben.id);
      expect((await emit(b, 'whois:vote', eve.id)).ok).toBe(false);
      await emit(b, 'whois:vote', ben.id);
      await emit(c, 'whois:vote', ana.id);
      await wait(60);
      const r = state[cleo.username]!;
      expect(r.stage).toBe('reveal');
      expect(r.results.map((x) => [x.user.id, x.votes])).toEqual([
        [ben.id, 2],
        [ana.id, 1],
        [cleo.id, 0],
      ]);
      await emit(a, 'whois:next');
      await wait(60);
    }
    const final = state[ben.username]!;
    expect(final.stage).toBe('final');
    expect(Object.fromEntries(final.players.map((p) => [p.user.id, p.score]))).toEqual({ [ana.id]: 50, [ben.id]: 50, [cleo.id]: 0 });
    expect(final.titles).toHaveLength(1);
    expect(final.titles[0]).toMatchObject({ user: { id: ben.id } });
    expect(final.titles[0].questions).toHaveLength(5);
    // La question de la bande fait partie du paquet.
    expect(seen).toContain(ana.id);
  });

  it('révèle à la fin du temps, même sans tous les votes', async () => {
    const [a] = sockets;
    whoisTiming.questionMs = 300;
    await emit(a, 'whois:next'); // retour au salon
    await emit(a, 'whois:start');
    await wait(60);
    await emit(a, 'whois:vote', ana.id);
    await wait(400);
    const r = state[ana.username]!;
    expect(r.stage).toBe('reveal');
    expect(r.results[0]).toMatchObject({ user: { id: ana.id }, votes: 1 });
    expect(r.players.find((p) => p.user.id === ana.id)?.score).toBe(10);
    whoisTiming.questionMs = 25_000;
  });

  it('invite par message avec un code QDN', async () => {
    const code = state[ana.username]!.code;
    expect((await call(ana, 'POST', '/api/game/invite', { code, userIds: [ben.id] })).body).toEqual({ sent: 1 });
    const conv = (await call(ben, 'POST', '/api/conversations', { userId: ana.id })).body.id;
    const last = (await call<Message[]>(ben, 'GET', `/api/conversations/${conv}/messages`)).body.at(-1)!;
    expect(last.meta).toEqual({ type: 'game_invite', code });
    expect(last.text).toContain('Qui de nous');
  });
});

describe('Rétro de l’année (#90)', () => {
  it('calcule la série la plus longue de semaines', () => {
    const w = (n: number) => new Date(Date.UTC(2026, 0, 4 + 7 * n, 19));
    expect(longestStreak([])).toBe(0);
    expect(longestStreak([w(0), w(1), w(2), w(5), w(6), w(1)])).toBe(3);
  });

  it('résume l’année de la personne, et seulement la sienne', async () => {
    const m = await upload(cleo, '/api/media', await jpeg('#AA00AA'));
    const post = (await call(cleo, 'POST', '/api/posts', { kind: 'photo', mediaId: m.body.id, text: 'Ma photo de l’année' })).body;
    await call(ana, 'PUT', `/api/posts/${post.id}/like`);
    await call(ben, 'PUT', `/api/posts/${post.id}/reaction`, { emoji: '🔥' });
    await call(ana, 'POST', `/api/posts/${post.id}/comments`, { text: 'Superbe' });
    const conv = (await call(cleo, 'POST', '/api/conversations', { userId: ben.id })).body.id;
    for (const text of ['Salut', 'Ça va ?', 'On sort ?']) await call(cleo, 'POST', `/api/conversations/${conv}/messages`, { text });
    await call(ben, 'POST', `/api/conversations/${conv}/messages`, { text: 'Oui !' });
    const year = new Date().getFullYear();
    const r = (await call<RetroState>(cleo, 'GET', `/api/retro?year=${year}`)).body;
    expect(r.year).toBe(year);
    expect(r.enough).toBe(true);
    expect(r.posts).toMatchObject({ total: 1, photos: 1, likes: 1, reactions: 1, comments: 1 });
    expect(r.topPost?.id).toBe(post.id);
    expect(r.pellicule).toMatchObject({ shots: 2, weeks: 1, bestStreak: 1 });
    expect(r.messages.sent).toBe(3);
    expect(r.messages.topFriend).toMatchObject({ user: { id: ben.id }, count: 4 });
    expect(r.friends.total).toBe(2);
    expect(r.busiestMonth?.count).toBeGreaterThan(0);
    expect(r.circle.members).toBe(5);
    // Une autre année : rien.
    const old = (await call<RetroState>(cleo, 'GET', '/api/retro?year=2024')).body;
    expect(old).toMatchObject({ year: 2024, enough: false, topPost: null });
    // Année absurde : celle par défaut.
    expect((await call<RetroState>(cleo, 'GET', '/api/retro?year=1900')).body.year).toBe(retroYear() ?? year);
  });
});
