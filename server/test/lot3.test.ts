import type { Conversation, ConversationDetail, Message, Page, Post, StoryGroup, StoryView } from '@mandrix/shared';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { HISTORY_PAGE } from '../src/routes/messages.js';
import { befriend, call, jpeg, makeUser, upload, useApp, type TestUser } from './helpers.js';

useApp();

let lea: TestUser, noah: TestUser, maya: TestUser, inconnu: TestUser;

beforeAll(async () => {
  [lea, noah, maya, inconnu] = await Promise.all(['lea', 'noah', 'maya', 'inconnu'].map(makeUser));
  await befriend(lea, noah);
  await befriend(noah, maya);
});

const photo = async (u: TestUser, text = '') => {
  const m = await upload(u, '/api/media', await jpeg());
  return (await call<Post>(u, 'POST', '/api/posts', { kind: 'photo', mediaId: m.body.id, text })).body;
};

describe('visibilité des posts (#34)', () => {
  it('un post réservé aux amis est introuvable hors du cercle, même avec son lien', async () => {
    const p = await photo(lea, 'Entre nous');
    expect((await call(noah, 'GET', `/api/posts/${p.id}`)).status).toBe(200);
    for (const [method, url, body] of [
      ['GET', `/api/posts/${p.id}`, undefined],
      ['GET', `/api/posts/${p.id}/comments`, undefined],
      ['POST', `/api/posts/${p.id}/comments`, { text: 'Coucou' }],
      ['PUT', `/api/posts/${p.id}/like`, undefined],
      ['PUT', `/api/posts/${p.id}/reaction`, { emoji: '🔥' }],
      ['PUT', `/api/posts/${p.id}/repost`, undefined],
    ] as const) {
      expect((await call(inconnu, method, url, body)).status, `${method} ${url}`).toBe(404);
    }
  });

  it('un post republié par un ami devient visible pour ses amis', async () => {
    const p = await photo(lea, 'À partager');
    expect((await call(maya, 'GET', `/api/posts/${p.id}`)).status).toBe(404);
    await call(noah, 'PUT', `/api/posts/${p.id}/repost`);
    expect((await call(maya, 'GET', `/api/posts/${p.id}`)).status).toBe(200);
  });
});

describe('fil par curseur (#35)', () => {
  it('ni doublon ni trou quand des posts arrivent pendant le défilement', async () => {
    const zoe = await makeUser('zoe');
    const ids: string[] = [];
    for (let i = 0; i < 18; i++) ids.push((await photo(zoe, `n°${i}`)).id);
    const first = (await call<Page<Post>>(zoe, 'GET', '/api/feed')).body;
    expect(first.items).toHaveLength(15);
    expect(typeof first.next).toBe('string');
    // Deux nouveaux posts entre les deux pages.
    await photo(zoe, 'nouveau 1');
    await photo(zoe, 'nouveau 2');
    const second = (await call<Page<Post>>(zoe, 'GET', `/api/feed?cursor=${first.next}`)).body;
    const seen = [...first.items, ...second.items].map((p) => p.id);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual([...ids].sort());
    expect(second.next).toBeNull();
    expect((await call(zoe, 'GET', '/api/feed?cursor=nimporte')).status).toBe(400);
  });
});

describe('légende modifiable (#42)', () => {
  it('seul l’auteur modifie, et seules les nouvelles mentions sont notifiées', async () => {
    const p = await photo(noah, `Avec @${lea.username}`);
    expect((await call(lea, 'PATCH', `/api/posts/${p.id}`, { text: 'Piraté' })).status).toBe(404);
    const edited = (await call<Post>(noah, 'PATCH', `/api/posts/${p.id}`, { text: `Avec @${lea.username} et @${maya.username}` })).body;
    expect(edited.edited).toBe(true);
    expect(edited.text).toContain(maya.username);
    const leaMentions = (await call(lea, 'GET', '/api/notifications')).body.filter((n: { type: string }) => n.type === 'mention');
    const mayaMentions = (await call(maya, 'GET', '/api/notifications')).body.filter((n: { type: string }) => n.type === 'mention');
    expect(leaMentions).toHaveLength(1);
    expect(mayaMentions).toHaveLength(1);
  });
});

describe('messages (#36, #38, #39)', () => {
  let conv: string;

  beforeAll(async () => {
    conv = (await call(lea, 'POST', '/api/conversations', { userId: noah.id })).body.id;
    // Historique plus long qu'une page.
    const values = Array.from({ length: HISTORY_PAGE + 20 }, (_, i) => sql`(${conv}::uuid, ${lea.id}::uuid, ${`ancien ${i}`}, now() - make_interval(mins => ${HISTORY_PAGE + 20 - i}))`);
    await db.execute(sql`insert into messages (conversation_id, sender_id, text, created_at) values ${sql.join(values, sql`, `)}`);
  });

  it('remonte dans l’historique page par page', async () => {
    const latest = (await call<Message[]>(noah, 'GET', `/api/conversations/${conv}/messages`)).body;
    expect(latest).toHaveLength(HISTORY_PAGE);
    expect(latest.at(-1)?.text).toBe(`ancien ${HISTORY_PAGE + 19}`);
    const older = (await call<Message[]>(noah, 'GET', `/api/conversations/${conv}/messages?before=${latest[0].id}`)).body;
    expect(older).toHaveLength(20);
    expect(older[0].text).toBe('ancien 0');
    expect(older.at(-1)!.createdAt < latest[0].createdAt).toBe(true);
  });

  it('supprime un message pour tout le monde, et sa citation', async () => {
    const m = (await call<Message>(lea, 'POST', `/api/conversations/${conv}/messages`, { text: 'Oups, mauvais message' })).body;
    const reply = (await call<Message>(noah, 'POST', `/api/conversations/${conv}/messages`, { text: 'Quoi ?', replyToId: m.id })).body;
    await call(noah, 'PUT', `/api/messages/${m.id}/reaction`, { emoji: '😂' });
    expect((await call(noah, 'DELETE', `/api/messages/${m.id}`)).status).toBe(403);
    const gone = (await call<Message>(lea, 'DELETE', `/api/messages/${m.id}`)).body;
    expect(gone).toMatchObject({ id: m.id, deleted: true, text: '', media: null, reactions: [] });
    const list = (await call<Message[]>(noah, 'GET', `/api/conversations/${conv}/messages`)).body;
    expect(list.find((x) => x.id === m.id)).toMatchObject({ deleted: true, text: '' });
    expect(list.find((x) => x.id === reply.id)?.meta).toMatchObject({ type: 'reply', replyTo: { id: m.id, text: 'Message supprimé' } });
    expect((await call(noah, 'PUT', `/api/messages/${m.id}/reaction`, { emoji: '❤️' })).status).toBe(404);
  });

  it('met une conversation en sourdine', async () => {
    expect((await call(noah, 'PATCH', `/api/conversations/${conv}/mute`, { muted: true })).body).toEqual({ muted: true });
    expect((await call<ConversationDetail>(noah, 'GET', `/api/conversations/${conv}`)).body.muted).toBe(true);
    expect((await call<Conversation[]>(noah, 'GET', '/api/conversations')).body.find((c) => c.id === conv)?.muted).toBe(true);
    expect((await call<Conversation[]>(lea, 'GET', '/api/conversations')).body.find((c) => c.id === conv)?.muted).toBe(false);
    await call(lea, 'POST', `/api/conversations/${conv}/messages`, { text: 'Tu dors ?' });
    // Les non-lus restent comptés.
    expect((await call(noah, 'GET', '/api/badges')).body.messages).toBe(1);
  });
});

describe('vues des stories (#40)', () => {
  it('l’auteur voit qui a vu sa story, les autres non', async () => {
    const m = await upload(noah, '/api/media', await jpeg('#AA66CC'));
    const story = (await call(noah, 'POST', '/api/stories', { mediaId: m.body.id })).body;
    await call(lea, 'POST', `/api/stories/${story.id}/seen`);
    await call(maya, 'POST', `/api/stories/${story.id}/seen`);
    await call(inconnu, 'POST', `/api/stories/${story.id}/seen`); // pas ami : ignoré
    await call(noah, 'POST', `/api/stories/${story.id}/seen`); // soi-même : ignoré
    const viewers = (await call<StoryView[]>(noah, 'GET', `/api/stories/${story.id}/viewers`)).body;
    expect(viewers.map((v) => v.user.id).sort()).toEqual([lea.id, maya.id].sort());
    expect((await call(lea, 'GET', `/api/stories/${story.id}/viewers`)).status).toBe(404);
    const mine = (await call<StoryGroup[]>(noah, 'GET', '/api/stories')).body.find((g) => g.user.id === noah.id)!;
    expect(mine.stories.at(-1)?.views).toBe(2);
    const theirs = (await call<StoryGroup[]>(lea, 'GET', '/api/stories')).body.find((g) => g.user.id === noah.id)!;
    expect(theirs.stories.at(-1)?.views).toBeNull();
  });
});
