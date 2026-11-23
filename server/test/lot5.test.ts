import type { AdminStats, AppNotification, Conversation, Post, UserProfile } from '@mandrix/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { announceBirthdays } from '../src/lib/birthdays.js';
import { parisMonthDay } from '../src/lib/users.js';
import { befriend, call, jpeg, makeUser, upload, useApp, type TestUser } from './helpers.js';

useApp();

let admin: TestUser, lea: TestUser, noah: TestUser, inconnu: TestUser;

beforeAll(async () => {
  admin = await makeUser('admin');
  [lea, noah, inconnu] = await Promise.all(['lea', 'noah', 'inconnu'].map(makeUser));
  await befriend(lea, noah);
});

describe('carrousel (#61)', () => {
  it('publie plusieurs photos dans un post, dans l’ordre', async () => {
    const ids: string[] = [];
    for (const c of ['#111111', '#222222', '#333333']) ids.push((await upload(lea, '/api/media', await jpeg(c))).body.id);
    const p = (await call<Post>(lea, 'POST', '/api/posts', { kind: 'photo', mediaId: ids[0], extraMediaIds: ids.slice(1), text: 'Week-end' })).body;
    expect(p.gallery?.map((m) => m.id)).toEqual(ids);
    expect(p.media?.id).toBe(ids[0]);
    const seen = (await call<Post>(noah, 'GET', `/api/posts/${p.id}`)).body;
    expect(seen.gallery).toHaveLength(3);
    // Les photos d'un autre ne peuvent pas rejoindre le carrousel.
    const other = (await upload(noah, '/api/media', await jpeg())).body.id;
    expect((await call(lea, 'POST', '/api/posts', { kind: 'photo', mediaId: ids[0], extraMediaIds: [other] })).status).toBe(400);
    // Une seule photo : pas de galerie.
    const single = (await call<Post>(lea, 'POST', '/api/posts', { kind: 'photo', mediaId: (await upload(lea, '/api/media', await jpeg())).body.id })).body;
    expect(single.gallery).toBeNull();
  });
});

describe('conversations épinglées (#59)', () => {
  it('une conversation épinglée passe en tête', async () => {
    const a = (await call(lea, 'POST', '/api/conversations', { userId: noah.id })).body.id;
    const zoe = await makeUser('zoe');
    await befriend(lea, zoe);
    const b = (await call(lea, 'POST', '/api/conversations', { userId: zoe.id })).body.id;
    await call(lea, 'POST', `/api/conversations/${a}/messages`, { text: 'Premier' });
    await call(lea, 'POST', `/api/conversations/${b}/messages`, { text: 'Plus récent' });
    expect((await call<Conversation[]>(lea, 'GET', '/api/conversations')).body[0].id).toBe(b);
    await call(lea, 'PATCH', `/api/conversations/${a}/pin`, { pinned: true });
    const list = (await call<Conversation[]>(lea, 'GET', '/api/conversations')).body;
    expect(list[0]).toMatchObject({ id: a, pinned: true });
    expect(list[1].pinned).toBe(false);
  });
});

describe('anniversaires (#62)', () => {
  it('date valide, visible par les amis, fêtée le jour J', async () => {
    expect((await call(noah, 'PATCH', '/api/me', { birthday: '02-30' })).status).toBe(400);
    const today = parisMonthDay();
    expect((await call(noah, 'PATCH', '/api/me', { birthday: today })).body.birthday).toBe(today);
    const asFriend = (await call<UserProfile>(lea, 'GET', `/api/users/${noah.username}`)).body;
    expect(asFriend).toMatchObject({ birthday: today, birthdayToday: true });
    expect((await call<UserProfile>(inconnu, 'GET', `/api/users/${noah.username}`)).body.birthday).toBeNull();

    expect(await announceBirthdays(today, 2026)).toBe(1);
    await announceBirthdays(today, 2026); // pas de doublon
    const notifs = (await call<AppNotification[]>(lea, 'GET', '/api/notifications')).body.filter((n) => n.type === 'birthday');
    expect(notifs).toHaveLength(1);
    expect(notifs[0].actor?.id).toBe(noah.id);
  });
});

describe('tableau de bord admin (#65)', () => {
  it('chiffres et stockage pour l’admin seulement', async () => {
    expect((await call(lea, 'GET', '/api/admin/stats')).status).toBe(403);
    const s = (await call<AdminStats>(admin, 'GET', '/api/admin/stats')).body;
    expect(s.users).toBeGreaterThanOrEqual(4);
    expect(s.posts).toBeGreaterThanOrEqual(2);
    expect(s.mediaBytes).toBeGreaterThan(0);
    expect(s.databaseBytes).toBeGreaterThan(0);
    expect(s.disk?.totalBytes ?? 1).toBeGreaterThan(0);
  });
});
