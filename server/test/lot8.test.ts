import type { MediaRef, MemberCard, Page, Post } from '@mandrix/shared';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { app, befriend, call, makeUser, upload, useApp, type TestUser } from './helpers.js';

useApp();

let me: TestUser, amie: TestUser, amieDAmie: TestUser, demandeuse: TestUser, attendue: TestUser, bloquee: TestUser, suspendue: TestUser, inconnue: TestUser;

beforeAll(async () => {
  [me, amie, amieDAmie, demandeuse, attendue, bloquee, suspendue, inconnue] = await Promise.all(
    ['moi', 'amie', 'amiedamie', 'demande', 'attendue', 'bloquee', 'suspendue', 'inconnue'].map(makeUser),
  );
  await befriend(me, amie);
  await befriend(amie, amieDAmie);
  await call(demandeuse, 'POST', `/api/friends/${me.id}`);
  await call(me, 'POST', `/api/friends/${attendue.id}`);
  await call(me, 'POST', `/api/users/${bloquee.id}/block`);
  await db.execute(sql`update users set suspended_at = now() where id = ${suspendue.id}`);
  await call(amieDAmie, 'PATCH', '/api/me', { displayName: 'Éloïse Durand', city: 'Lyon', bio: 'Photo et vélo' });
});

describe('tous les membres (#93)', () => {
  it('range les membres et donne leur présentation', async () => {
    const page = (await call<Page<MemberCard>>(me, 'GET', '/api/users/directory')).body;
    const ids = page.items.map((m) => m.id);
    expect(ids).not.toContain(me.id);
    expect(ids).not.toContain(bloquee.id);
    expect(ids).not.toContain(suspendue.id);
    // Demande reçue, puis pas encore amis (amis en commun d'abord), puis demande envoyée, puis amis.
    expect(ids).toEqual([demandeuse.id, amieDAmie.id, inconnue.id, attendue.id, amie.id]);
    const eloise = page.items.find((m) => m.id === amieDAmie.id)!;
    expect(eloise).toMatchObject({ displayName: 'Éloïse Durand', city: 'Lyon', bio: 'Photo et vélo', friendship: 'none', mutual: 1, friends: 1, posts: 0 });
    expect(eloise.mutualPreview.map((u) => u.id)).toEqual([amie.id]);
    expect(page.items.map((m) => m.friendship)).toEqual(['pending_in', 'none', 'none', 'pending_out', 'friends']);
    expect(page.next).toBeNull();
    // La personne bloquée ne me voit pas non plus.
    expect((await call<Page<MemberCard>>(bloquee, 'GET', '/api/users/directory')).body.items.map((m) => m.id)).not.toContain(me.id);
  });

  it('cherche sans accents ni casse, et pagine', async () => {
    const found = (await call<Page<MemberCard>>(me, 'GET', '/api/users/directory?q=ELOISE')).body.items;
    expect(found.map((m) => m.id)).toEqual([amieDAmie.id]);
    expect((await call<Page<MemberCard>>(me, 'GET', `/api/users/directory?q=${encodeURIComponent('%')}`)).body.items).toEqual([]);
    await Promise.all(Array.from({ length: 22 }, (_, i) => makeUser(`m${i}`)));
    const first = (await call<Page<MemberCard>>(me, 'GET', '/api/users/directory')).body;
    expect(first.items).toHaveLength(24);
    expect(first.next).toBe(1);
    const second = (await call<Page<MemberCard>>(me, 'GET', '/api/users/directory?page=1')).body;
    expect(second.items).toHaveLength(3);
    expect(second.next).toBeNull();
    const all = [...first.items, ...second.items].map((m) => m.id);
    expect(new Set(all).size).toBe(27);
  });
});

describe('GIF animés', () => {
  const animatedGif = async (width = 800, height = 500) => {
    const frames = await Promise.all(['#ff0000', '#00ff00', '#0000ff'].map((background) => sharp({ create: { width, height, channels: 3, background } }).png().toBuffer()));
    return { name: 'anim.gif', type: 'image/gif', data: await sharp(frames, { join: { animated: true } }).gif({ delay: 150, loop: 0 }).toBuffer() };
  };
  const pagesOf = async (url: string) => {
    const res = await app.inject({ method: 'GET', url, headers: { cookie: me.cookie } });
    expect(res.statusCode).toBe(200);
    return (await sharp(res.rawPayload).metadata()).pages ?? 1;
  };

  it('restent animés une fois postés, miniatures comprises', async () => {
    const m = (await upload<MediaRef>(me, '/api/media', await animatedGif())).body;
    expect(m).toMatchObject({ kind: 'image', width: 800, height: 500 });
    expect(await pagesOf(m.url)).toBe(3);
    expect(await pagesOf(`${m.url}?w=360`)).toBe(3);
    const post = (await call<Post>(me, 'POST', '/api/posts', { kind: 'photo', mediaId: m.id, text: 'Ça bouge' })).body;
    expect(await pagesOf(post.media!.url)).toBe(3);
  });

  it('une photo de profil reste fixe', async () => {
    const res = await upload<{ avatarUrl: string }>(me, '/api/me/avatar', await animatedGif(300, 300));
    expect(res.status).toBe(200);
    expect(await pagesOf(res.body.avatarUrl)).toBe(1);
  });
});
