import { ANONYMOUS_AUTHOR, borderlineHits, type AppNotification, type Comment, type Message, type ModerationCase, type Page, type Post } from '@mandrix/shared';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, befriend, call, jpeg, makeUser, upload, useApp, wait, type TestUser } from './helpers.js';

useApp();

// Posts anonymes : l'auteur ne doit fuiter ni dans l'API, ni dans les notifications, ni dans le temps réel.
let admin: TestUser, lea: TestUser, noah: TestUser, inconnu: TestUser, bloque: TestUser;
let anon: Post;
let url = '';
const sockets: Socket[] = [];

/** Rien dans la réponse ne permet de remonter au compte de l'auteur. */
function expectNoLeak(body: unknown, author: TestUser) {
  const s = JSON.stringify(body);
  expect(s).not.toContain(author.id);
  expect(s).not.toContain(author.username);
}

function connect(user: TestUser) {
  const s = io(url, { path: '/socket.io', transports: ['websocket'], extraHeaders: { cookie: user.cookie } });
  sockets.push(s);
  return new Promise<Socket>((resolve, reject) => {
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

beforeAll(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  // Le premier compte créé est administrateur.
  admin = await makeUser('admin');
  lea = await makeUser('lea');
  noah = await makeUser('noah');
  inconnu = await makeUser('inconnu');
  bloque = await makeUser('bloque');
  await befriend(lea, noah);
  await call(bloque, 'POST', `/api/users/${lea.id}/block`);
});

afterAll(() => sockets.forEach((s) => s.disconnect()));

describe('posts anonymes', () => {
  it('signe « Anonyme » pour tout le monde, sauf « mine » pour l’auteur', async () => {
    const m = await upload(lea, '/api/media', await jpeg());
    const res = await call<Post>(lea, 'POST', '/api/posts', {
      kind: 'photo',
      mediaId: m.body.id,
      text: `J’avoue un secret @${inconnu.username}`,
      anonymous: true,
    });
    expect(res.status).toBe(200);
    anon = res.body;
    expect(anon.anonymous).toBe(true);
    expect(anon.mine).toBe(true);
    expect(anon.author).toEqual(ANONYMOUS_AUTHOR);
    expect(anon.realAuthor).toBeUndefined();
  });

  it('est visible de tous les membres, ami de l’auteur ou non, sans fuite', async () => {
    for (const u of [noah, inconnu]) {
      const feed = await call<Page<Post>>(u, 'GET', '/api/feed');
      const p = feed.body.items.find((x) => x.id === anon.id);
      expect(p, u.username).toBeTruthy();
      expect(p!.author).toEqual(ANONYMOUS_AUTHOR);
      expect(p!.mine).toBe(false);
      expectNoLeak(feed.body, lea);
      const one = await call<Post>(u, 'GET', `/api/posts/${anon.id}`);
      expect(one.status).toBe(200);
      expectNoLeak(one.body, lea);
    }
    const search = await call(inconnu, 'GET', `/api/search?q=${encodeURIComponent('secret')}`);
    expect(search.body.posts.map((p: Post) => p.id)).toContain(anon.id);
    expectNoLeak(search.body, lea);
  });

  it('un post normal reste réservé aux amis', async () => {
    const res = await call<Post>(lea, 'POST', '/api/posts', { kind: 'poll', pollKind: 'text', text: 'Pizza ou sushis ?', options: [{ label: 'Pizza' }, { label: 'Sushis' }] });
    expect(res.body.anonymous).toBe(false);
    expect(res.body.author.id).toBe(lea.id);
    expect((await call(inconnu, 'GET', `/api/posts/${res.body.id}`)).status).toBe(404);
  });

  it('les admins voient l’auteur réel', async () => {
    const res = await call<Post>(admin, 'GET', `/api/posts/${anon.id}`);
    expect(res.body.author).toEqual(ANONYMOUS_AUTHOR);
    expect(res.body.realAuthor?.id).toBe(lea.id);
  });

  it('n’apparaît pas sur le profil des autres et ne compte pas dans ses posts', async () => {
    const seen = await call(noah, 'GET', `/api/users/${lea.username}/posts`);
    expect(seen.body.items.map((p: Post) => p.id)).not.toContain(anon.id);
    const own = await call(lea, 'GET', `/api/users/${lea.username}/posts`);
    expect(own.body.items.map((p: Post) => p.id)).toContain(anon.id);
    const profile = await call(noah, 'GET', `/api/users/${lea.username}`);
    // Seul le sondage (non anonyme) compte.
    expect(profile.body.stats.posts).toBe(1);
    const dir = await call(inconnu, 'GET', `/api/users/directory?q=${lea.username}`);
    expect(dir.body.items.find((c: { id: string }) => c.id === lea.id)?.posts).toBe(1);
  });

  it('refuse le pool du jeu et l’épinglage sur le profil', async () => {
    const m = await upload(lea, '/api/media', await jpeg('#AA3355'));
    const pooled = await call(lea, 'POST', '/api/posts', { kind: 'photo', mediaId: m.body.id, pool: 'public', anonymous: true });
    expect(pooled.status).toBe(400);
    expect((await call(noah, 'POST', '/api/pool', { postId: anon.id, scope: 'public' })).status).toBe(400);
    expect((await call(lea, 'PUT', '/api/me/pinned-post', { postId: anon.id })).status).toBe(400);
  });

  it('prévient la personne mentionnée sans dire qui l’a mentionnée', async () => {
    const list = await call<AppNotification[]>(inconnu, 'GET', '/api/notifications');
    const n = list.body.find((x) => x.type === 'mention');
    expect(n).toBeTruthy();
    expect(n!.actor).toBeNull();
    expect(n!.data.anonymous).toBe(true);
    expectNoLeak(list.body, lea);
  });

  it('garde l’auteur anonyme quand il répond sous son post', async () => {
    const c = await call<Comment>(noah, 'POST', `/api/posts/${anon.id}/comments`, { text: 'C’est qui ?' });
    expect(c.body.anonymous).toBe(false);
    const reply = await call<Comment>(lea, 'POST', `/api/posts/${anon.id}/comments`, { text: 'Devine', parentId: c.body.id });
    expect(reply.body.anonymous).toBe(true);
    expect(reply.body.mine).toBe(true);
    expect(reply.body.author.displayName).toBe('Anonyme · auteur');

    const forNoah = await call<Comment[]>(noah, 'GET', `/api/posts/${anon.id}/comments`);
    const r = forNoah.body.find((x) => x.id === reply.body.id)!;
    expect(r.anonymous).toBe(true);
    expect(r.mine).toBe(false);
    expectNoLeak(forNoah.body, lea);
    const forAdmin = await call<Comment[]>(admin, 'GET', `/api/posts/${anon.id}/comments`);
    expect(forAdmin.body.find((x) => x.id === reply.body.id)?.realAuthor?.id).toBe(lea.id);

    // La notification « t'a répondu » ne porte pas l'auteur.
    const notifs = await call<AppNotification[]>(noah, 'GET', '/api/notifications');
    const n = notifs.body.find((x) => x.type === 'comment' && x.data.reply);
    expect(n?.actor).toBeNull();
    expectNoLeak(notifs.body, lea);
  });

  it('se partage en message sans auteur', async () => {
    const res = await call(noah, 'POST', `/api/posts/${anon.id}/share`, { userIds: [lea.id], text: '' });
    expect(res.body.sent).toHaveLength(1);
    const msgs = await call<Message[]>(noah, 'GET', `/api/conversations/${res.body.sent[0]}/messages`);
    const shared = msgs.body.find((m) => m.meta?.type === 'post_share');
    expect(shared?.meta?.type === 'post_share' && shared.meta.post?.author).toEqual(ANONYMOUS_AUTHOR);
  });

  it('se signale sans bloquer l’auteur caché ; les admins le voient en modération', async () => {
    const r = await call(inconnu, 'POST', '/api/reports', { targetType: 'post', targetId: anon.id, reason: 'Contenu choquant', block: true });
    expect(r.status).toBe(200);
    const blocks = await call(inconnu, 'GET', '/api/me/blocks');
    expect(blocks.body).toEqual([]);
    const cases = await call<ModerationCase[]>(admin, 'GET', '/api/admin/moderation');
    const k = cases.body.find((x) => x.targetId === anon.id)!;
    expect(k.anonymous).toBe(true);
    expect(k.author?.id).toBe(lea.id);
    // L’auteur ne peut pas republier son propre post (il le sait, lui).
    expect((await call(lea, 'PUT', `/api/posts/${anon.id}/repost`)).status).toBe(400);
  });

  it('temps réel : « feed:new » à tous sans auteur, sauf l’auteur et les comptes bloqués', async () => {
    const [sLea, sNoah, sInconnu, sBloque] = await Promise.all([lea, noah, inconnu, bloque].map(connect));
    const got = new Map<string, { postId: string; authorId: string | null }[]>();
    for (const [name, s] of [['lea', sLea], ['noah', sNoah], ['inconnu', sInconnu], ['bloque', sBloque]] as const) {
      got.set(name, []);
      s.on('feed:new', (e) => got.get(name)!.push(e));
    }
    const res = await call<Post>(lea, 'POST', '/api/posts', { kind: 'poll', pollKind: 'slider', text: 'Note ma tenue', anonymous: true });
    await wait(200);
    const id = res.body.id;
    expect(got.get('lea')).toEqual([{ postId: id, authorId: lea.id }]);
    expect(got.get('noah')).toEqual([{ postId: id, authorId: null }]);
    expect(got.get('inconnu')).toEqual([{ postId: id, authorId: null }]);
    expect(got.get('bloque')).toEqual([]);
    // Un compte bloqué ne voit pas le post (comme les autres contenus de la personne).
    expect((await call(bloque, 'GET', `/api/posts/${id}`)).status).toBe(404);
  });
});

describe('détection des contenus « limite »', () => {
  it('repère insultes, ragots, sexe et drogue, sans accents ni casse', () => {
    expect(borderlineHits('T’es vraiment un CONNARD')).toEqual(['connard']);
    expect(borderlineHits('J’avoue… j’ai un crush')).toEqual(["j'avoue", 'crush']);
    expect(borderlineHits('Il paraît que Léa sort avec Noah')).toEqual(['il parait que']);
    expect(borderlineHits('Elle le trompe depuis des mois')).toEqual(['elle le trompe']);
    expect(borderlineHits('Complètement défoncés hier')).toEqual(['defonces']);
    expect(borderlineHits('ce soir 🍆')).toEqual(['🍆']);
    // Plusieurs textes (question et options d'un sondage).
    expect(borderlineHits('Qui est le plus…', 'débile', '')).toEqual(['debile']);
  });

  it('ne se déclenche pas sur des mots qui en contiennent un autre', () => {
    for (const t of ['Bonne soirée à tous !', 'Le calcul est faux', 'Une technique de ouf', 'Voir le fichier ci-joint', 'Je me trompe peut-être', 'Grosse dispute au foot', 'J’habite à Lyon', 'Au sein de l’équipe']) {
      expect(borderlineHits(t), t).toEqual([]);
    }
  });
});
