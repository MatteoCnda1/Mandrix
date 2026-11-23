import type { AppNotification, Comment, Conversation, ConversationDetail, Message, Post, ProfilePosts, ShareResult, UserProfile } from '@mandrix/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { contentSecurityPolicy, inlineScriptHashes } from '../src/lib/security.js';
import { app, befriend, call, jpeg, makeUser, upload, useApp, type TestUser } from './helpers.js';

useApp();

let lea: TestUser, noah: TestUser, maya: TestUser, inconnu: TestUser;

beforeAll(async () => {
  [lea, noah, maya, inconnu] = await Promise.all(['lea', 'noah', 'maya', 'inconnu'].map(makeUser));
  await befriend(lea, noah);
  await befriend(noah, maya);
});

const nameOf = async (u: TestUser) => (await call<UserProfile>(u, 'GET', `/api/users/${u.username}`)).body.displayName;

const photo = async (u: TestUser, text = '') => {
  const m = await upload(u, '/api/media', await jpeg());
  return (await call<Post>(u, 'POST', '/api/posts', { kind: 'photo', mediaId: m.body.id, text })).body;
};

describe('partager un post en message (#73)', () => {
  it('envoie un aperçu du post aux amis qui peuvent le voir', async () => {
    const p = await photo(lea, 'Regarde ça');
    const res = (await call<ShareResult>(lea, 'POST', `/api/posts/${p.id}/share`, { userIds: [noah.id], text: 'Pour toi' })).body;
    expect(res.sent).toHaveLength(1);
    expect(res.refused).toEqual([]);
    const msgs = (await call<Message[]>(noah, 'GET', `/api/conversations/${res.sent[0]}/messages`)).body;
    const m = msgs.at(-1)!;
    expect(m.text).toBe('Pour toi');
    expect(m.meta).toMatchObject({ type: 'post_share', postId: p.id, post: { id: p.id, text: 'Regarde ça', author: { id: lea.id } } });
    const list = (await call<Conversation[]>(noah, 'GET', '/api/conversations')).body;
    expect(list.find((c) => c.id === res.sent[0])?.last?.text).toBe('Pour toi');
  });

  it('refuse une conversation dont un membre ne peut pas voir le post', async () => {
    const p = await photo(lea, 'Entre amis');
    const group = (await call(noah, 'POST', '/api/conversations', { userIds: [lea.id, maya.id], title: 'Trio' })).body.id;
    const res = (await call<ShareResult>(noah, 'POST', `/api/posts/${p.id}/share`, { conversationIds: [group] })).body;
    expect(res.sent).toEqual([]);
    expect(res.refused).toEqual([await nameOf(maya)]);
    // Hors du cercle : le post n'existe pas.
    expect((await call(inconnu, 'POST', `/api/posts/${p.id}/share`, { userIds: [lea.id] })).status).toBe(404);
    // Pas ami : refusé.
    const r2 = (await call<ShareResult>(lea, 'POST', `/api/posts/${p.id}/share`, { userIds: [maya.id] })).body;
    expect(r2).toEqual({ sent: [], refused: [await nameOf(maya)] });
  });

  it('l’aperçu disparaît quand le post est supprimé', async () => {
    const p = await photo(lea, 'Éphémère');
    const { sent } = (await call<ShareResult>(lea, 'POST', `/api/posts/${p.id}/share`, { userIds: [noah.id] })).body;
    await call(lea, 'DELETE', `/api/posts/${p.id}`);
    const m = (await call<Message[]>(noah, 'GET', `/api/conversations/${sent[0]}/messages`)).body.at(-1)!;
    expect(m.meta).toEqual({ type: 'post_share', postId: p.id, post: null });
    const list = (await call<Conversation[]>(noah, 'GET', '/api/conversations')).body;
    expect(list.find((c) => c.id === sent[0])?.last?.text).toBe('↗️ Post partagé');
  });
});

describe('répondre à un commentaire (#74)', () => {
  it('range les réponses sous le commentaire et prévient la personne', async () => {
    const p = await photo(noah, 'Débat');
    const top = (await call<Comment>(lea, 'POST', `/api/posts/${p.id}/comments`, { text: 'Premier !' })).body;
    expect(top.parentId).toBeNull();
    const reply = (await call<Comment>(maya, 'POST', `/api/posts/${p.id}/comments`, { text: 'Non, moi', parentId: top.id })).body;
    expect(reply.parentId).toBe(top.id);
    // Répondre à une réponse : rangé sous le même commentaire.
    const again = (await call<Comment>(lea, 'POST', `/api/posts/${p.id}/comments`, { text: 'Si si', parentId: reply.id })).body;
    expect(again.parentId).toBe(top.id);
    const notifs = (await call<AppNotification[]>(lea, 'GET', '/api/notifications')).body;
    expect(notifs.some((n) => n.type === 'comment' && n.data.reply === true && n.actor?.id === maya.id)).toBe(true);
    const mayaNotifs = (await call<AppNotification[]>(maya, 'GET', '/api/notifications')).body;
    expect(mayaNotifs.some((n) => n.type === 'comment' && n.data.reply === true && n.actor?.id === lea.id)).toBe(true);
    // Un commentaire d'un autre post n'est pas un parent valable.
    const other = await photo(noah, 'Autre');
    expect((await call(lea, 'POST', `/api/posts/${other.id}/comments`, { text: 'x', parentId: top.id })).status).toBe(400);
    // Supprimer le commentaire emporte ses réponses.
    await call(lea, 'DELETE', `/api/comments/${top.id}`);
    expect((await call<Comment[]>(noah, 'GET', `/api/posts/${p.id}/comments`)).body).toEqual([]);
  });
});

describe('chercher dans une conversation (#76)', () => {
  it('trouve sans tenir compte des accents ni de la casse', async () => {
    const conv = (await call(lea, 'POST', '/api/conversations', { userId: noah.id })).body.id;
    for (const text of ['Café ce soir ?', 'Pas de CAFE pour moi', 'Thé alors', '100% d’accord']) {
      await call(lea, 'POST', `/api/conversations/${conv}/messages`, { text });
    }
    const hits = (await call<Message[]>(noah, 'GET', `/api/conversations/${conv}/search?q=cafe`)).body;
    expect(hits.map((m) => m.text)).toEqual(['Pas de CAFE pour moi', 'Café ce soir ?']);
    // Les jokers SQL sont pris au pied de la lettre.
    expect((await call<Message[]>(noah, 'GET', `/api/conversations/${conv}/search?q=${encodeURIComponent('0%')}`)).body.map((m) => m.text)).toEqual(['100% d’accord']);
    expect((await call<Message[]>(noah, 'GET', `/api/conversations/${conv}/search?q=c`)).body).toEqual([]);
    expect((await call(inconnu, 'GET', `/api/conversations/${conv}/search?q=cafe`)).status).toBe(404);
  });
});

describe('photo du groupe (#77)', () => {
  it('un membre change la photo, tout le monde la voit', async () => {
    const group = (await call(noah, 'POST', '/api/conversations', { userIds: [lea.id, maya.id], title: 'Photo' })).body.id;
    const res = await upload<ConversationDetail>(lea, `/api/conversations/${group}/photo`, await jpeg('#FF8800'));
    expect(res.status).toBe(200);
    expect(res.body.photo?.kind).toBe('image');
    const list = (await call<Conversation[]>(maya, 'GET', '/api/conversations')).body;
    expect(list.find((c) => c.id === group)?.photo?.id).toBe(res.body.photo!.id);
    expect((await upload(inconnu, `/api/conversations/${group}/photo`, await jpeg())).status).toBe(404);
    const dm = (await call(lea, 'POST', '/api/conversations', { userId: noah.id })).body.id;
    expect((await upload(lea, `/api/conversations/${dm}/photo`, await jpeg())).status).toBe(400);
    const removed = (await call<ConversationDetail>(maya, 'DELETE', `/api/conversations/${group}/photo`)).body;
    expect(removed.photo).toBeNull();
    const msgs = (await call<Message[]>(noah, 'GET', `/api/conversations/${group}/messages`)).body;
    expect(msgs.filter((m) => m.meta?.type === 'system').map((m) => m.text)).toContain(`${await nameOf(maya)} a retiré la photo du groupe`);
  });
});

describe('épingler un post sur son profil (#81)', () => {
  it('le post épinglé passe en tête, à part', async () => {
    const a = await photo(maya, 'Ancien');
    await photo(maya, 'Récent');
    expect((await call(maya, 'PUT', '/api/me/pinned-post', { postId: a.id })).body).toEqual({ pinnedPostId: a.id });
    const profile = (await call<UserProfile>(noah, 'GET', `/api/users/${maya.username}`)).body;
    expect(profile.pinnedPostId).toBe(a.id);
    const posts = (await call<ProfilePosts>(noah, 'GET', `/api/users/${maya.username}/posts?tab=posts`)).body;
    expect(posts.pinned?.id).toBe(a.id);
    expect(posts.items.map((p) => p.id)).not.toContain(a.id);
    // Hors du cercle : rien.
    expect((await call<UserProfile>(inconnu, 'GET', `/api/users/${maya.username}`)).body.pinnedPostId).toBeNull();
    // Pas le post d'un autre.
    const other = await photo(noah, 'À moi');
    expect((await call(maya, 'PUT', '/api/me/pinned-post', { postId: other.id })).status).toBe(404);
    // Supprimer le post le désépingle.
    await call(maya, 'DELETE', `/api/posts/${a.id}`);
    expect((await call<UserProfile>(maya, 'GET', `/api/users/${maya.username}`)).body.pinnedPostId).toBeNull();
  });
});

describe('en-têtes de sécurité (#80)', () => {
  it('protège les réponses et autorise le script de thème par empreinte', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('same-origin');
    expect(String(res.headers['permissions-policy'])).toContain('camera=(self)');
    const hashes = inlineScriptHashes('<script>a()</script><script type="module" src="/x.js"></script>');
    // sha256("a()") en base64
    expect(hashes).toEqual(["'sha256-qVpDBgj7bpq5hMAcGp3AOc79J3Y1Z4HvySTwKrWDoy4='"]);
    const csp = contentSecurityPolicy(hashes);
    expect(csp).toContain("script-src 'self' 'sha256-");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });
});

describe('correctifs de l’audit du lot 5', () => {
  it('un identifiant d’envoi ne sert que dans sa conversation, et deux envois simultanés font un seul message', async () => {
    const dm = (await call(lea, 'POST', '/api/conversations', { userId: noah.id })).body.id;
    const group = (await call(noah, 'POST', '/api/conversations', { userIds: [lea.id, maya.id], title: 'Envois' })).body.id;
    const clientId = 'tmp-audit-0001';
    const [a, b] = await Promise.all([
      call<Message>(lea, 'POST', `/api/conversations/${dm}/messages`, { text: 'ok', clientId }),
      call<Message>(lea, 'POST', `/api/conversations/${dm}/messages`, { text: 'ok', clientId }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.id).toBe(b.body.id);
    // Réutilisé ailleurs : refusé, sans renvoyer le message de l'autre conversation.
    const other = await call<Message>(lea, 'POST', `/api/conversations/${group}/messages`, { text: 'j’arrive', clientId });
    expect(other.status).toBe(409);
  });

  it('le 🎂 du jour n’est montré qu’aux amis', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', month: '2-digit', day: '2-digit' }).format(new Date()).replace('/', '-');
    await call(maya, 'PATCH', '/api/me', { birthday: today });
    expect((await call<UserProfile>(noah, 'GET', `/api/users/${maya.username}`)).body.birthdayToday).toBe(true);
    expect((await call<UserProfile>(inconnu, 'GET', `/api/users/${maya.username}`)).body.birthdayToday).toBeUndefined();
    // Dans un groupe, un membre qui n'est pas son ami ne le voit pas non plus.
    const group = (await call(noah, 'POST', '/api/conversations', { userIds: [lea.id, maya.id], title: 'Fête' })).body.id;
    const seenByLea = (await call<ConversationDetail>(lea, 'GET', `/api/conversations/${group}`)).body.members.find((m) => m.id === maya.id);
    const seenByNoah = (await call<ConversationDetail>(noah, 'GET', `/api/conversations/${group}`)).body.members.find((m) => m.id === maya.id);
    expect(seenByLea?.birthdayToday).toBeUndefined();
    expect(seenByNoah?.birthdayToday).toBe(true);
    await call(maya, 'PATCH', '/api/me', { birthday: null });
  });

  it('né un 29 février : fêté le 28 les années non bissextiles', async () => {
    const { isBirthdayToday } = await import('../src/lib/users.js');
    expect(isBirthdayToday('02-29', new Date('2027-02-28T12:00:00Z'))).toBe(true);
    expect(isBirthdayToday('02-29', new Date('2028-02-28T12:00:00Z'))).toBe(false);
    expect(isBirthdayToday('02-29', new Date('2028-02-29T12:00:00Z'))).toBe(true);
    expect(isBirthdayToday(null)).toBe(false);
  });

  it('supprimer un message garde une image encore utilisée par un sondage', async () => {
    const m = (await upload(lea, '/api/media', await jpeg('#33AA55'))).body;
    const m2 = (await upload(lea, '/api/media', await jpeg('#AA3355'))).body;
    const poll = await call(lea, 'POST', '/api/posts', { kind: 'poll', text: 'Laquelle ?', pollKind: 'image', options: [{ label: 'A', mediaId: m.id }, { label: 'B', mediaId: m2.id }] });
    expect(poll.status).toBe(200);
    const dm = (await call(lea, 'POST', '/api/conversations', { userId: noah.id })).body.id;
    const msg = (await call<Message>(lea, 'POST', `/api/conversations/${dm}/messages`, { text: '', mediaId: m.id })).body;
    await call(lea, 'DELETE', `/api/messages/${msg.id}`);
    expect((await app.inject({ method: 'GET', url: `/media/${m.id}`, headers: { cookie: lea.cookie } })).statusCode).toBe(200);
  });
});
