import type { ConversationDetail, Message, Page, Post } from '@mandrix/shared';
import { sql } from 'drizzle-orm';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { app, befriend, call, jpeg, makeUser, upload, useApp, wait, type TestUser } from './helpers.js';

useApp();

let url = '';
let lea: TestUser, noah: TestUser;
const sockets: Socket[] = [];

beforeAll(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  [lea, noah] = await Promise.all(['lea', 'noah'].map(makeUser));
  await befriend(lea, noah);
});

afterAll(() => sockets.forEach((s) => s.disconnect()));

describe('présence et blocage (#66)', () => {
  it('un ancien ami ne voit plus la présence, même avec la conversation', async () => {
    const conv = (await call(lea, 'POST', '/api/conversations', { userId: noah.id })).body.id;
    const s = io(url, { path: '/socket.io', transports: ['websocket'], extraHeaders: { cookie: noah.cookie } });
    sockets.push(s);
    await new Promise<void>((r) => s.on('connect', () => r()));
    await wait(100);
    expect((await call<ConversationDetail>(lea, 'GET', `/api/conversations/${conv}`)).body.presence?.online).toBe(true);
    await call(noah, 'POST', `/api/users/${lea.id}/block`);
    expect((await call<ConversationDetail>(lea, 'GET', `/api/conversations/${conv}`)).body.presence).toBeNull();
    await call(noah, 'DELETE', `/api/users/${lea.id}/block`);
    await befriend(lea, noah);
  });
});

describe('messages (#68, #69, #70)', () => {
  let conv: string;
  beforeAll(async () => {
    conv = (await call(lea, 'POST', '/api/conversations', { userId: noah.id })).body.id;
  });

  it('un renvoi avec le même identifiant ne crée pas de doublon', async () => {
    const a = (await call<Message>(lea, 'POST', `/api/conversations/${conv}/messages`, { text: 'Une seule fois', clientId: 'tmp-123456789' })).body;
    const b = (await call<Message>(lea, 'POST', `/api/conversations/${conv}/messages`, { text: 'Une seule fois', clientId: 'tmp-123456789' })).body;
    expect(b.id).toBe(a.id);
    const list = (await call<Message[]>(noah, 'GET', `/api/conversations/${conv}/messages`)).body;
    expect(list.filter((m) => m.text === 'Une seule fois')).toHaveLength(1);
  });

  it('la pièce jointe d’un message supprimé n’est plus téléchargeable', async () => {
    const photo = (await upload(lea, '/api/media', await jpeg('#AA3355'))).body;
    const m = (await call<Message>(lea, 'POST', `/api/conversations/${conv}/messages`, { mediaId: photo.id })).body;
    expect((await call(noah, 'GET', photo.url)).status).toBe(200);
    await call(lea, 'DELETE', `/api/messages/${m.id}`);
    expect((await call(noah, 'GET', photo.url)).status).toBe(404);
  });

  it('?before= invalide : 400, pas 500', async () => {
    expect((await call(lea, 'GET', `/api/conversations/${conv}/messages?before=pas-un-id`)).status).toBe(400);
  });

  it('historique : pas de message sauté dans la même milliseconde', async () => {
    const c2 = conv;
    // 101 messages ; les deux plus anciens à la même milliseconde (microsecondes différentes).
    await db.execute(sql`insert into messages (conversation_id, sender_id, text, created_at)
      select ${c2}::uuid, ${lea.id}::uuid, 'm' || g, timestamptz '2026-01-01 10:00:00.123400+00' + make_interval(secs => g) from generate_series(2, 100) g`);
    await db.execute(sql`insert into messages (conversation_id, sender_id, text, created_at) values
      (${c2}::uuid, ${lea.id}::uuid, 'm0', timestamptz '2026-01-01 10:00:01.123100+00'),
      (${c2}::uuid, ${lea.id}::uuid, 'm1', timestamptz '2026-01-01 10:00:01.123300+00')`);
    const latest = (await call<Message[]>(lea, 'GET', `/api/conversations/${c2}/messages`)).body;
    const older = (await call<Message[]>(lea, 'GET', `/api/conversations/${c2}/messages?before=${latest[0].id}`)).body;
    const texts = [...older, ...latest].map((m) => m.text).filter((t) => /^m\d+$/.test(t));
    expect(new Set(texts).size).toBe(101);
  });
});

describe('fil : curseur précis (#70)', () => {
  it('pas de post sauté à la limite d’une page dans la même milliseconde', async () => {
    const solo = await makeUser('solo');
    const m = await upload(solo, '/api/media', await jpeg());
    const ids: string[] = [];
    for (let i = 0; i < 16; i++) ids.push((await call<Post>(solo, 'POST', '/api/posts', { kind: 'poll', pollKind: 'slider', text: `q${i}` })).body.id);
    void m;
    // Posts 14 et 15 (au bord de la première page) : même milliseconde, microsecondes différentes.
    await db.execute(sql`update posts set created_at = timestamptz '2026-01-01 12:00:00.555100+00' + make_interval(secs => 30 - n) from (select id, row_number() over () as n from unnest(${sql.raw(`ARRAY[${ids.map((i) => `'${i}'::uuid`).join(',')}]`)}) as id) t where posts.id = t.id`);
    await db.execute(sql`update posts set created_at = timestamptz '2026-01-01 12:00:00.555300+00' where id = ${ids[14]}`);
    await db.execute(sql`update posts set created_at = timestamptz '2026-01-01 12:00:00.555200+00' where id = ${ids[15]}`);
    const first = (await call<Page<Post>>(solo, 'GET', '/api/feed')).body;
    const second = (await call<Page<Post>>(solo, 'GET', `/api/feed?cursor=${first.next}`)).body;
    const seen = [...first.items, ...second.items].map((p) => p.id);
    expect(new Set(seen).size).toBe(16);
  });
});
