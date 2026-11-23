import type { AppNotification, FriendSuggestion, ModerationCase, Post, PostSearch, UserProfile } from '@mandrix/shared';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { notifyEndedPolls } from '../src/lib/polls.js';
import { befriend, call, jpeg, makeUser, register, upload, useApp, type TestUser } from './helpers.js';

useApp();

let admin: TestUser, lea: TestUser, noah: TestUser, maya: TestUser, zoe: TestUser, inconnu: TestUser;
let photo: Post;

const notifs = async (u: TestUser) => (await call<AppNotification[]>(u, 'GET', '/api/notifications')).body;

beforeAll(async () => {
  // Le premier compte de la base est administrateur.
  admin = await makeUser('admin');
  [lea, noah, maya, zoe, inconnu] = await Promise.all(['lea', 'noah', 'maya', 'zoe', 'inconnu'].map(makeUser));
  await befriend(lea, noah);
  await befriend(lea, maya);
  await befriend(noah, zoe);
  await befriend(maya, zoe);
  const m = await upload(lea, '/api/media', await jpeg('#F4A62A'));
  photo = (await call<Post>(lea, 'POST', '/api/posts', { kind: 'photo', mediaId: m.body.id, text: `Raclette avec @${noah.username} et @${inconnu.username}. #Raclette #hiver` })).body;
});

describe('réactions emoji', () => {
  it('une réaction par personne, modifiable, notifiée une seule fois', async () => {
    let r = await call<Pick<Post, 'reactions' | 'myReaction'>>(noah, 'PUT', `/api/posts/${photo.id}/reaction`, { emoji: '😂' });
    expect(r.body).toEqual({ reactions: [{ emoji: '😂', count: 1 }], myReaction: '😂' });
    r = await call(noah, 'PUT', `/api/posts/${photo.id}/reaction`, { emoji: '🔥' });
    expect(r.body).toEqual({ reactions: [{ emoji: '🔥', count: 1 }], myReaction: '🔥' });
    await call(maya, 'PUT', `/api/posts/${photo.id}/reaction`, { emoji: '🔥' });
    const reactions = (await notifs(lea)).filter((n) => n.type === 'reaction');
    expect(reactions).toHaveLength(1);
    expect(reactions[0].data).toMatchObject({ postId: photo.id, others: 1 });
    expect((await call(noah, 'PUT', `/api/posts/${photo.id}/reaction`, { emoji: '🍕' })).status).toBe(400);
    r = await call(noah, 'DELETE', `/api/posts/${photo.id}/reaction`);
    expect(r.body).toEqual({ reactions: [{ emoji: '🔥', count: 1 }], myReaction: null });
  });
});

describe('mentions et hashtags', () => {
  it('notifie les amis mentionnés, pas les inconnus', async () => {
    expect((await notifs(noah)).some((n) => n.type === 'mention' && n.data.postId === photo.id)).toBe(true);
    expect((await notifs(inconnu)).some((n) => n.type === 'mention')).toBe(false);
  });

  it('mentionne aussi dans les commentaires', async () => {
    await call(lea, 'POST', `/api/posts/${photo.id}/comments`, { text: `On invite @${maya.username} ?` });
    expect((await notifs(maya)).find((n) => n.type === 'mention')?.data).toMatchObject({ where: 'comment', postId: photo.id });
    // Noah et Maya ne sont pas amis : pas de notification.
    await call(noah, 'POST', `/api/posts/${photo.id}/comments`, { text: `Salut @${zoe.username} et @${maya.username}` });
    expect((await notifs(maya)).filter((n) => n.type === 'mention')).toHaveLength(1);
    // Zoé est amie de Noah mais ne voit pas le post de Léa : pas de notification non plus.
    expect((await notifs(zoe)).some((n) => n.type === 'mention')).toBe(false);
  });

  it('retrouve un post par hashtag et par texte, dans le cercle seulement', async () => {
    const byTag = (await call<PostSearch>(noah, 'GET', `/api/search?q=${encodeURIComponent('#raclette')}`)).body;
    expect(byTag.posts.map((p) => p.id)).toEqual([photo.id]);
    expect((await call<PostSearch>(noah, 'GET', `/api/search?q=${encodeURIComponent('#rac')}`)).body.posts).toHaveLength(0);
    expect((await call<PostSearch>(noah, 'GET', '/api/search?q=raclette')).body.posts).toHaveLength(1);
    expect((await call<PostSearch>(inconnu, 'GET', '/api/search?q=raclette')).body.posts).toHaveLength(0);
  });
});

describe('sondages', () => {
  it('accepte six options, pas sept', async () => {
    const options = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `Choix ${i + 1}` }));
    expect((await call(lea, 'POST', '/api/posts', { kind: 'poll', pollKind: 'text', text: 'Quel film ?', options: options(7) })).status).toBe(400);
    const ok = await call<Post>(lea, 'POST', '/api/posts', { kind: 'poll', pollKind: 'text', text: 'Quel film ?', options: options(6), durationHours: 24, isPublic: true });
    expect(ok.status).toBe(200);
    expect(ok.body.poll?.options).toHaveLength(6);
    expect(ok.body.poll?.endsAt).toBeTruthy();
    expect(ok.body.poll?.closed).toBe(false);
  });

  it('montre les votants, puis fige le résultat à la fin et prévient l’auteur', async () => {
    const poll = (
      await call<Post>(lea, 'POST', '/api/posts', {
        kind: 'poll',
        pollKind: 'text',
        text: 'Pizza ou raclette ?',
        options: [{ label: 'Pizza' }, { label: 'Raclette' }],
        durationHours: 1,
        isPublic: true,
      })
    ).body;
    const raclette = poll.poll!.options[1].id;
    const voted = (await call(noah, 'POST', `/api/posts/${poll.id}/vote`, { optionId: raclette })).body;
    expect(voted.options[1].voters.map((u: { id: string }) => u.id)).toEqual([noah.id]);

    await db.execute(sql`update posts set poll_ends_at = now() - interval '1 minute' where id = ${poll.id}`);
    expect((await call(maya, 'POST', `/api/posts/${poll.id}/vote`, { optionId: raclette })).status).toBe(409);
    expect((await call<Post>(maya, 'GET', `/api/posts/${poll.id}`)).body.poll?.closed).toBe(true);

    expect(await notifyEndedPolls()).toBeGreaterThanOrEqual(1);
    expect(await notifyEndedPolls()).toBe(0);
    const ended = (await notifs(lea)).find((n) => n.type === 'poll_ended');
    expect(ended?.data).toMatchObject({ postId: poll.id, total: 1 });
    expect(String(ended?.data.result)).toContain('Raclette');
  });
});

describe('suggestions d’amis', () => {
  it('propose les amis de mes amis, par amis en commun', async () => {
    const list = (await call<FriendSuggestion[]>(lea, 'GET', '/api/friends/suggestions')).body;
    expect(list[0]).toMatchObject({ user: { id: zoe.id }, mutual: 2 });
    expect(list.some((s) => s.user.id === noah.id || s.user.id === inconnu.id)).toBe(false);
  });
});

describe('blocage', () => {
  it('coupe l’amitié, le profil, la recherche et les messages', async () => {
    const conv = (await call(maya, 'POST', '/api/conversations', { userId: lea.id })).body.id;
    expect((await call(maya, 'POST', `/api/users/${lea.id}/block`)).status).toBe(200);

    expect((await call(lea, 'GET', `/api/users/${maya.username}`)).status).toBe(404);
    expect((await call<UserProfile>(maya, 'GET', `/api/users/${lea.username}`)).body.blockedByMe).toBe(true);
    expect((await call(lea, 'POST', `/api/conversations/${conv}/messages`, { text: 'Coucou ?' })).status).toBe(403);
    expect((await call(lea, 'POST', `/api/friends/${maya.id}`)).status).toBe(403);
    expect((await call<PostSearch>(lea, 'GET', `/api/search?q=${maya.username}`)).body.users).toHaveLength(0);
    expect((await call(maya, 'GET', '/api/me/blocks')).body.map((u: { id: string }) => u.id)).toEqual([lea.id]);

    await call(maya, 'DELETE', `/api/users/${lea.id}/block`);
    expect((await call(lea, 'GET', `/api/users/${maya.username}`)).status).toBe(200);
  });
});

describe('signalements et modération', () => {
  it('masque un post signalé trois fois et le montre à l’admin', async () => {
    const m = await upload(noah, '/api/media', await jpeg('#222222'));
    const post = (await call<Post>(noah, 'POST', '/api/posts', { kind: 'photo', mediaId: m.body.id, text: 'Douteux' })).body;
    expect((await call(noah, 'POST', '/api/reports', { targetType: 'post', targetId: post.id, reason: 'Spam' })).status).toBe(400);
    for (const u of [lea, zoe]) await call(u, 'POST', '/api/reports', { targetType: 'post', targetId: post.id, reason: 'Spam' });
    expect((await call<Post>(lea, 'GET', `/api/posts/${post.id}`)).status).toBe(200);
    const third = await call(inconnu, 'POST', '/api/reports', { targetType: 'post', targetId: post.id, reason: 'Contenu choquant' });
    expect(third.body.hidden).toBe(true);
    expect((await call(lea, 'GET', `/api/posts/${post.id}`)).status).toBe(404);
    // L'auteur voit encore son post.
    expect((await call(noah, 'GET', `/api/posts/${post.id}`)).status).toBe(200);

    expect((await call(lea, 'GET', '/api/admin/moderation')).status).toBe(403);
    const queue = (await call<ModerationCase[]>(admin, 'GET', '/api/admin/moderation')).body;
    const c = queue.find((x) => x.targetId === post.id)!;
    expect(c).toMatchObject({ targetType: 'post', reports: 3, hidden: true, author: { id: noah.id } });

    await call(admin, 'POST', '/api/admin/moderation/resolve', { targetType: 'post', targetId: post.id, action: 'dismiss' });
    expect((await call(lea, 'GET', `/api/posts/${post.id}`)).status).toBe(200);
    expect((await call<ModerationCase[]>(admin, 'GET', '/api/admin/moderation')).body.some((x) => x.targetId === post.id)).toBe(false);
  });

  it('suspend un compte : session fermée et connexion refusée', async () => {
    const victim = await makeUser('suspendu');
    expect((await call(admin, 'POST', `/api/admin/users/${victim.id}/suspend`)).status).toBe(200);
    expect((await call(victim, 'GET', '/api/auth/me')).status).toBe(401);
    const login = await call(null, 'POST', '/api/auth/login', { login: victim.username, password: 'motdepasse1' });
    expect(login.status).toBe(403);
    await call(admin, 'DELETE', `/api/admin/users/${victim.id}/suspend`);
    expect((await call(null, 'POST', '/api/auth/login', { login: victim.username, password: 'motdepasse1' })).status).toBe(200);
    // Inscription toujours possible pour les autres.
    expect((await register('nouveau_venu')).status).toBe(200);
  });
});
