import type { Post } from '@mandrix/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { befriend, call, jpeg, makeUser, upload, useApp, type TestUser } from './helpers.js';

useApp();

let lea: TestUser, noah: TestUser, inconnu: TestUser;
let photo: Post;

beforeAll(async () => {
  lea = await makeUser('lea');
  noah = await makeUser('noah');
  inconnu = await makeUser('inconnu');
  await befriend(lea, noah);
});

describe('posts et fil', () => {
  it('publie une photo (convertie en WebP sans métadonnées)', async () => {
    const m = await upload(lea, '/api/media', await jpeg());
    expect(m.status).toBe(200);
    expect(m.body.kind).toBe('image');
    const res = await call<Post>(lea, 'POST', '/api/posts', { kind: 'photo', mediaId: m.body.id, text: 'Il me juge', pool: 'public' });
    expect(res.status).toBe(200);
    photo = res.body;
    expect(photo.pool).toBe('public');
    const file = await call(lea, 'GET', photo.media!.url);
    expect(file.raw.headers['content-type']).toBe('image/webp');
  });

  it('montre le post aux amis seulement', async () => {
    const feedNoah = await call(noah, 'GET', '/api/feed');
    expect(feedNoah.body.items.map((p: Post) => p.id)).toContain(photo.id);
    const feedInconnu = await call(inconnu, 'GET', '/api/feed');
    expect(feedInconnu.body.items).toHaveLength(0);
  });

  it('compte les j’aime, commentaires et republications', async () => {
    expect((await call(noah, 'PUT', `/api/posts/${photo.id}/like`)).status).toBe(200);
    await call(noah, 'PUT', `/api/posts/${photo.id}/like`); // idempotent
    await call(noah, 'POST', `/api/posts/${photo.id}/comments`, { text: 'Trop bien' });
    expect((await call(lea, 'PUT', `/api/posts/${photo.id}/repost`)).status).toBe(400);
    await call(noah, 'PUT', `/api/posts/${photo.id}/repost`);
    const p = (await call<Post>(lea, 'GET', `/api/posts/${photo.id}`)).body;
    expect([p.likes, p.comments, p.reposts]).toEqual([1, 1, 1]);
    await call(noah, 'DELETE', `/api/posts/${photo.id}/like`);
    expect((await call<Post>(lea, 'GET', `/api/posts/${photo.id}`)).body.likes).toBe(0);
  });

  it('gère les sondages à choix et à curseur', async () => {
    const poll = (await call<Post>(lea, 'POST', '/api/posts', { kind: 'poll', pollKind: 'text', text: 'Pizza ananas ?', options: [{ label: 'Crime' }, { label: 'Génie' }] })).body;
    const [crime, genie] = poll.poll!.options;
    await call(noah, 'POST', `/api/posts/${poll.id}/vote`, { optionId: crime.id });
    const changed = (await call(noah, 'POST', `/api/posts/${poll.id}/vote`, { optionId: genie.id })).body;
    expect(changed.total).toBe(1);
    expect(changed.myVote).toBe(genie.id);

    const slider = (await call<Post>(lea, 'POST', '/api/posts', { kind: 'poll', pollKind: 'slider', text: 'Motivation ?' })).body;
    await call(noah, 'POST', `/api/posts/${slider.id}/vote`, { value: 80 });
    const res = (await call(lea, 'POST', `/api/posts/${slider.id}/vote`, { value: 40 })).body;
    expect(res.average).toBe(60);
  });

  it('refuse un sondage incomplet', async () => {
    const res = await call(lea, 'POST', '/api/posts', { kind: 'poll', pollKind: 'text', text: 'Une seule option ?', options: [{ label: 'Oui' }] });
    expect(res.status).toBe(400);
  });
});
