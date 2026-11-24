import type { MediaRef, MemberCard, Page, Post } from '@mandrix/shared';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { IMPORT_MANIFEST, importPool } from '../src/lib/poolImport.js';
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

describe('import d’images dans le pool', () => {
  it('ajoute les images d’un dossier au pool public, sans doublon à la relance', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mandrix-pool-'));
    for (const [name, background] of [
      ['a.jpg', '#ff8800'],
      ['b.jpeg', '#0088ff'],
    ] as const) {
      await fs.writeFile(path.join(dir, name), await sharp({ create: { width: 640, height: 480, channels: 3, background } }).jpeg().toBuffer());
    }
    await fs.writeFile(path.join(dir, 'notes.txt'), 'pas une image');
    await fs.writeFile(path.join(dir, 'casse.jpg'), 'pas vraiment un jpeg');
    const before = (await call<{ publicCount: number }>(me, 'GET', '/api/pool/stats')).body.publicCount;
    const first = await importPool(dir, me.id, 'public');
    expect(first.imported).toBe(2);
    expect(first.failed.map((f) => f.file)).toEqual(['casse.jpg']);
    expect((await call<{ publicCount: number }>(me, 'GET', '/api/pool/stats')).body.publicCount).toBe(before + 2);
    const again = await importPool(dir, me.id, 'public');
    expect(again).toMatchObject({ imported: 0, skipped: 2 });
    const manifest = JSON.parse(await fs.readFile(path.join(dir, IMPORT_MANIFEST), 'utf8'));
    expect(Object.keys(manifest).sort()).toEqual(['a.jpg', 'b.jpeg']);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('stories dans le pool', () => {
  const jpg = async (background: string) => ({ name: 'story.jpg', type: 'image/jpeg', data: await sharp({ create: { width: 540, height: 960, channels: 3, background } }).jpeg().toBuffer() });
  const poolCount = async () => (await call<{ publicCount: number }>(me, 'GET', '/api/pool/stats')).body.publicCount;

  it('une story (la sienne ou celle d’un ami) peut rejoindre le pool, pas celle d’un inconnu', async () => {
    const m = (await upload<MediaRef>(amie, '/api/media', await jpg('#aa44ff'))).body;
    const story = (await call<{ id: string }>(amie, 'POST', '/api/stories', { mediaId: m.id })).body;
    const before = await poolCount();
    // Pas amie avec l'autrice : introuvable.
    expect((await call(inconnue, 'POST', '/api/pool', { storyId: story.id, scope: 'public' })).status).toBe(404);
    expect((await call(me, 'POST', '/api/pool', { storyId: story.id, scope: 'public' })).body).toEqual({ pool: 'public' });
    expect(await poolCount()).toBe(before + 1);
    const groups = (await call<{ user: { id: string }; stories: { id: string; pool: string | null }[] }[]>(me, 'GET', '/api/stories')).body;
    expect(groups.find((g) => g.user.id === amie.id)?.stories.find((s) => s.id === story.id)?.pool).toBe('public');
    const notifs = (await call<{ type: string; data: { storyId?: string } }[]>(amie, 'GET', '/api/notifications')).body;
    expect(notifs.some((n) => n.type === 'pool_added' && n.data.storyId === story.id)).toBe(true);
    // Retirer : celle qui l'a ajoutée (ou l'autrice).
    expect((await call(me, 'POST', '/api/pool/remove', { storyId: story.id })).body).toEqual({ pool: null });
    expect(await poolCount()).toBe(before);
    // Story expirée : on ne peut plus l'ajouter.
    await db.execute(sql`update stories set expires_at = now() - interval '1 minute' where id = ${story.id}`);
    expect((await call(amie, 'POST', '/api/pool', { storyId: story.id, scope: 'public' })).status).toBe(404);
  });

  it('un post qu’on ne peut pas voir ne rejoint pas le pool', async () => {
    const m = (await upload<MediaRef>(amieDAmie, '/api/media', await jpg('#44aa88'))).body;
    const post = (await call<Post>(amieDAmie, 'POST', '/api/posts', { kind: 'photo', mediaId: m.id })).body;
    expect((await call(me, 'POST', '/api/pool', { postId: post.id, scope: 'public' })).status).toBe(404);
    expect((await call(amie, 'POST', '/api/pool', { postId: post.id, scope: 'friends' })).body).toEqual({ pool: 'friends' });
  });
});
