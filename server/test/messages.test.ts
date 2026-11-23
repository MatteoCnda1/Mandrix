import type { Conversation, ConversationDetail, Message } from '@mandrix/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { befriend, call, jpeg, makeUser, upload, useApp, type TestUser } from './helpers.js';

useApp();

let mathis: TestUser, lea: TestUser, noah: TestUser, maya: TestUser, inconnu: TestUser;

beforeAll(async () => {
  [mathis, lea, noah, maya, inconnu] = await Promise.all(['mathis', 'lea', 'noah', 'maya', 'inconnu'].map(makeUser));
  for (const f of [lea, noah, maya]) await befriend(mathis, f);
  await befriend(lea, noah);
});

describe('messages privés', () => {
  it('permet d’écrire à un ami mais pas à un inconnu', async () => {
    expect((await call(mathis, 'POST', '/api/conversations', { userId: inconnu.id })).status).toBe(403);
    const { id } = (await call(mathis, 'POST', '/api/conversations', { userId: lea.id })).body;
    await call(mathis, 'POST', `/api/conversations/${id}/messages`, { text: 'Salut Léa' });
    expect((await call(lea, 'GET', '/api/badges')).body.messages).toBe(1);
    await call(lea, 'GET', `/api/conversations/${id}/messages`);
    expect((await call(lea, 'GET', '/api/badges')).body.messages).toBe(0);
  });

  it('garde la photo de la story dans la réponse', async () => {
    const m = await upload(noah, '/api/media', await jpeg('#7BD389'));
    const story = (await call(noah, 'POST', '/api/stories', { mediaId: m.body.id })).body;
    const reply = (await call<Message>(lea, 'POST', `/api/messages/to/${noah.id}`, { text: 'Trop beau', storyId: story.id })).body;
    expect(reply.meta).toMatchObject({ type: 'story_reply', storyId: story.id });
    expect(reply.meta && 'media' in reply.meta && reply.meta.media?.id).toBe(m.body.id);
  });
});

describe('groupes', () => {
  let groupId: string;

  it('exige au moins deux amis', async () => {
    expect((await call(mathis, 'POST', '/api/conversations', { userIds: [lea.id] })).status).toBe(400);
    expect((await call(mathis, 'POST', '/api/conversations', { userIds: [lea.id, inconnu.id] })).status).toBe(403);
  });

  it('crée un groupe, diffuse les messages et compte les non-lus', async () => {
    groupId = (await call(mathis, 'POST', '/api/conversations', { userIds: [lea.id, noah.id], title: 'Soirée raclette' })).body.id;
    await call(lea, 'POST', `/api/conversations/${groupId}/messages`, { text: 'Je ramène le fromage' });
    const list = (await call<Conversation[]>(noah, 'GET', '/api/conversations')).body;
    const g = list.find((c) => c.id === groupId)!;
    expect(g.isGroup).toBe(true);
    expect(g.title).toBe('Soirée raclette');
    expect(g.last).toMatchObject({ text: 'Je ramène le fromage', sender: expect.any(String), system: false });
    expect(g.unread).toBe(true);
  });

  it('renomme, ajoute un ami et laisse partir un membre', async () => {
    const renamed = (await call<ConversationDetail>(noah, 'PATCH', `/api/conversations/${groupId}`, { title: 'Raclette samedi' })).body;
    expect(renamed.title).toBe('Raclette samedi');
    const added = (await call<ConversationDetail>(mathis, 'POST', `/api/conversations/${groupId}/members`, { userIds: [maya.id] })).body;
    expect(added.members).toHaveLength(4);

    await call(noah, 'POST', `/api/conversations/${groupId}/leave`);
    expect((await call(noah, 'GET', `/api/conversations/${groupId}`)).status).toBe(404);

    const msgs = (await call<Message[]>(maya, 'GET', `/api/conversations/${groupId}/messages`)).body;
    const system = msgs.filter((m) => m.meta?.type === 'system').map((m) => m.text);
    expect(system).toHaveLength(4);
    expect(system.at(-1)).toMatch(/a quitté le groupe/);
  });

  it('ne laisse pas un non-membre lire le groupe', async () => {
    expect((await call(inconnu, 'GET', `/api/conversations/${groupId}/messages`)).status).toBe(404);
  });
});
