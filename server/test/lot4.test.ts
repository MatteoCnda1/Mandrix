import type { Conversation, ConversationDetail, Message, PelliculeState, Presence } from '@mandrix/shared';
import { sql } from 'drizzle-orm';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { app, befriend, call, jpeg, makeUser, upload, useApp, wait, type TestUser } from './helpers.js';

useApp();

let url = '';
let admin: TestUser, lea: TestUser, noah: TestUser, maya: TestUser;
const sockets: Socket[] = [];

function connect(user: TestUser) {
  const s = io(url, { path: '/socket.io', transports: ['websocket'], extraHeaders: { cookie: user.cookie } });
  sockets.push(s);
  return new Promise<Socket>((resolve, reject) => {
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

const next = <T>(s: Socket, event: string, ms = 1500) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`pas de ${event}`)), ms);
    s.once(event, (v: T) => {
      clearTimeout(t);
      resolve(v);
    });
  });

beforeAll(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  admin = await makeUser('admin');
  [lea, noah, maya] = await Promise.all(['lea', 'noah', 'maya'].map(makeUser));
  await befriend(lea, noah);
  await befriend(lea, maya);
  await befriend(noah, maya);
});

afterAll(() => sockets.forEach((s) => s.disconnect()));

describe('présence (#44)', () => {
  it('en ligne, puis « actif il y a … », et rien si on masque la sienne', async () => {
    const conv = (await call(lea, 'POST', '/api/conversations', { userId: noah.id })).body.id;
    const leaSocket = await connect(lea);
    const online = next<Presence & { userId: string }>(leaSocket, 'presence');
    const noahSocket = await connect(noah);
    expect(await online).toMatchObject({ userId: noah.id, online: true });
    expect((await call<ConversationDetail>(lea, 'GET', `/api/conversations/${conv}`)).body.presence).toMatchObject({ online: true });
    expect((await call<Conversation[]>(lea, 'GET', '/api/conversations')).body.find((c) => c.id === conv)?.presence?.online).toBe(true);

    const offline = next<Presence & { userId: string }>(leaSocket, 'presence');
    noahSocket.disconnect();
    const off = await offline;
    expect(off).toMatchObject({ userId: noah.id, online: false });
    expect(off.lastSeenAt).toBeTruthy();

    // Léa masque sa présence : elle ne voit plus celle des autres.
    await call(lea, 'PATCH', '/api/me/presence', { show: false });
    expect((await call<ConversationDetail>(lea, 'GET', `/api/conversations/${conv}`)).body.presence).toBeNull();
    expect((await call<ConversationDetail>(noah, 'GET', `/api/conversations/${conv}`)).body.presence).toBeNull();
    await call(lea, 'PATCH', '/api/me/presence', { show: true });
  });
});

describe('pastille « Nouveaux posts » (#45)', () => {
  it('prévient les amis quand un post arrive', async () => {
    const mayaSocket = await connect(maya);
    const got = next<{ postId: string; authorId: string }>(mayaSocket, 'feed:new');
    const m = await upload(lea, '/api/media', await jpeg());
    const post = (await call(lea, 'POST', '/api/posts', { kind: 'photo', mediaId: m.body.id })).body;
    expect(await got).toEqual({ postId: post.id, authorId: lea.id });
  });
});

describe('groupes : retirer un membre (#47)', () => {
  it('seul le créateur retire, et la personne en est prévenue', async () => {
    const g = (await call<ConversationDetail>(lea, 'POST', '/api/conversations', { userIds: [noah.id, maya.id], title: 'Ciné' })).body;
    expect((await call(noah, 'DELETE', `/api/conversations/${g.id}/members/${maya.id}`)).status).toBe(403);
    const after = (await call<ConversationDetail>(lea, 'DELETE', `/api/conversations/${g.id}/members/${maya.id}`)).body;
    expect(after.members.map((u) => u.id).sort()).toEqual([lea.id, noah.id].sort());
    expect((await call(maya, 'GET', `/api/conversations/${g.id}`)).status).toBe(404);
    const msgs = (await call<Message[]>(noah, 'GET', `/api/conversations/${g.id}/messages`)).body;
    expect(msgs.at(-1)?.text).toContain('a retiré');
    expect((await call(lea, 'DELETE', `/api/conversations/${g.id}/members/${lea.id}`)).status).toBe(400);
  });
});

describe('Pellicule : annuler la dernière photo (#49)', () => {
  it('annulable quelques minutes, pas après', async () => {
    const st = (await upload<PelliculeState>(noah, '/api/pellicule/shots', await jpeg('#336699'))).body;
    expect(st.mine.total).toBe(1);
    expect(st.undo).toBeTruthy();
    expect((await call(lea, 'DELETE', `/api/pellicule/shots/${st.undo!.shotId}`)).status).toBe(404);
    const undone = (await call<PelliculeState>(noah, 'DELETE', `/api/pellicule/shots/${st.undo!.shotId}`)).body;
    expect(undone.mine.total).toBe(0);
    expect(undone.undo).toBeNull();

    const late = (await upload<PelliculeState>(noah, '/api/pellicule/shots', await jpeg('#663399'))).body;
    await db.execute(sql`update media set created_at = now() - interval '10 minutes' where id = (select media_id from shots where id = ${late.undo!.shotId})`);
    expect((await call(noah, 'DELETE', `/api/pellicule/shots/${late.undo!.shotId}`)).status).toBe(409);
  });
});

describe('admin : lien de réinitialisation (#50)', () => {
  it('donne un lien à usage unique qui change le mot de passe', async () => {
    expect((await call(lea, 'POST', `/api/admin/users/${maya.id}/reset-link`)).status).toBe(403);
    const { link } = (await call<{ link: string }>(admin, 'POST', `/api/admin/users/${maya.id}/reset-link`)).body;
    const token = new URL(link).searchParams.get('token')!;
    expect((await call(null, 'POST', '/api/auth/reset', { token, password: 'nouveau-secret-1' })).status).toBe(200);
    expect((await call(null, 'POST', '/api/auth/reset', { token, password: 'encore-un-autre' })).status).toBe(400);
    expect((await call(null, 'POST', '/api/auth/login', { login: maya.username, password: 'nouveau-secret-1' })).status).toBe(200);
    await wait(10);
  });
});
