import type { ConversationDetail, Message, MessageReaction, ReadMark, TypingEvent } from '@mandrix/shared';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, befriend, call, makeUser, useApp, wait, type TestUser } from './helpers.js';

useApp();

let url = '';
let lea: TestUser, noah: TestUser, maya: TestUser;
let convId: string;
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
  [lea, noah, maya] = await Promise.all(['lea', 'noah', 'maya'].map(makeUser));
  await befriend(lea, noah);
  convId = (await call(lea, 'POST', '/api/conversations', { userId: noah.id })).body.id;
});

afterAll(() => sockets.forEach((s) => s.disconnect()));

describe('conversation en temps réel', () => {
  it('relaie « en train d’écrire » aux membres seulement', async () => {
    const a = await connect(lea);
    const b = await connect(noah);
    const c = await connect(maya);
    let leaked = false;
    c.on('dm:typing', () => (leaked = true));
    const got = next<TypingEvent>(b, 'dm:typing');
    a.emit('dm:typing', convId, true);
    expect(await got).toEqual({ conversationId: convId, userId: lea.id, typing: true, activity: 'text' });
    // Enregistrement d'un vocal : l'activité suit.
    const voice = next<TypingEvent>(b, 'dm:typing');
    a.emit('dm:typing', convId, true, 'voice');
    expect((await voice).activity).toBe('voice');
    // Maya n'est pas dans la conversation : même en essayant, rien ne part.
    c.emit('dm:typing', convId, true);
    await wait(150);
    expect(leaked).toBe(false);
  });

  it('envoie l’accusé de lecture et les réactions', async () => {
    const [a, b] = sockets;
    const m = (await call<Message>(lea, 'POST', `/api/conversations/${convId}/messages`, { text: 'Tu viens ce soir ?' })).body;
    expect(m.reactions).toEqual([]);

    const read = next<ReadMark & { conversationId: string }>(a, 'dm:read');
    await call(noah, 'GET', `/api/conversations/${convId}/messages`);
    const r = await read;
    expect(r).toMatchObject({ conversationId: convId, userId: noah.id });
    expect(r.at >= m.createdAt).toBe(true);
    const detail = (await call<ConversationDetail>(lea, 'GET', `/api/conversations/${convId}`)).body;
    expect(detail.reads.map((x) => x.userId)).toEqual([noah.id]);

    const reacted = next<{ messageId: string; reactions: MessageReaction[] }>(a, 'dm:reaction');
    const res = await call<MessageReaction[]>(noah, 'PUT', `/api/messages/${m.id}/reaction`, { emoji: '❤️' });
    expect(res.body).toEqual([{ emoji: '❤️', userIds: [noah.id] }]);
    expect((await reacted).messageId).toBe(m.id);
    expect((await call(maya, 'PUT', `/api/messages/${m.id}/reaction`, { emoji: '❤️' })).status).toBe(404);
    const list = (await call<Message[]>(lea, 'GET', `/api/conversations/${convId}/messages`)).body;
    expect(list.at(-1)?.reactions).toEqual([{ emoji: '❤️', userIds: [noah.id] }]);
    expect((await call(noah, 'DELETE', `/api/messages/${m.id}/reaction`)).body).toEqual([]);
    void b;
  });
});
