import fs from 'node:fs';
import path from 'node:path';
import type { AppNotification, Me, SessionInfo } from '@mandrix/shared';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { mediaDir } from '../src/env.js';
import { inQuietHours, pushRecipients } from '../src/lib/push.js';
import { app, befriend, call, jpeg, makeUser, upload, useApp, type TestUser } from './helpers.js';

useApp();

let lea: TestUser, noah: TestUser;

/** Nouvelle session pour le même compte (un autre appareil). */
async function login(user: TestUser, password = 'motdepasse1', ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'content-type': 'application/json', 'user-agent': ua },
    payload: JSON.stringify({ login: user.username, password }),
  });
  const set = res.headers['set-cookie'];
  return { ...user, cookie: String(Array.isArray(set) ? set[0] : set).split(';')[0], status: res.statusCode };
}

beforeAll(async () => {
  [lea, noah] = await Promise.all(['lea', 'noah'].map(makeUser));
  await befriend(lea, noah);
});

describe('préférences de notifications', () => {
  it('coupe une catégorie dans la cloche', async () => {
    const m = await upload(lea, '/api/media', await jpeg());
    const post = (await call(lea, 'POST', '/api/posts', { kind: 'photo', mediaId: m.body.id })).body;
    const me = (await call<Me>(lea, 'PATCH', '/api/me/notifications', { bell: { social: false }, quiet: { start: 23, end: 8 } })).body;
    expect(me.notificationPrefs).toMatchObject({ bell: { social: false }, quiet: { start: 23, end: 8 } });
    await call(noah, 'PUT', `/api/posts/${post.id}/like`);
    await call(noah, 'POST', `/api/posts/${post.id}/comments`, { text: 'Joli' });
    const types = (await call<AppNotification[]>(lea, 'GET', '/api/notifications')).body.map((n) => n.type);
    expect(types).toContain('comment');
    expect(types).not.toContain('like');
    expect((await call(lea, 'PATCH', '/api/me/notifications', { push: { inconnu: false } })).status).toBe(400);
  });

  it('respecte les heures calmes et les catégories coupées en push', async () => {
    expect(inQuietHours({ quiet: { start: 23, end: 8 } }, 2)).toBe(true);
    expect(inQuietHours({ quiet: { start: 23, end: 8 } }, 12)).toBe(false);
    expect(inQuietHours({ quiet: { start: 13, end: 14 } }, 13)).toBe(true);
    await call(noah, 'PATCH', '/api/me/notifications', { push: { messages: false } });
    expect(await pushRecipients([noah.id], 'messages')).toEqual([]);
    expect(await pushRecipients([noah.id], 'pellicule')).toEqual([noah.id]);
  });
});

describe('compte', () => {
  it('liste les appareils et en déconnecte un', async () => {
    const phone = await login(lea);
    const list = (await call<SessionInfo[]>(lea, 'GET', '/api/me/sessions')).body;
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    const other = list.find((s) => s.device === 'iPhone · Safari')!;
    expect(other).toBeTruthy();
    await call(lea, 'DELETE', `/api/me/sessions/${other.id}`);
    expect((await call(phone, 'GET', '/api/auth/me')).status).toBe(401);
    expect((await call(lea, 'GET', '/api/auth/me')).status).toBe(200);
  });

  it('change le mot de passe et ferme les autres sessions', async () => {
    const other = await login(lea);
    expect((await call(lea, 'POST', '/api/me/password', { current: 'mauvais', next: 'nouveau-mdp-1' })).status).toBe(403);
    expect((await call(lea, 'POST', '/api/me/password', { current: 'motdepasse1', next: 'nouveau-mdp-1' })).status).toBe(200);
    expect((await call(other, 'GET', '/api/auth/me')).status).toBe(401);
    expect((await call(lea, 'GET', '/api/auth/me')).status).toBe(200);
    expect((await login(lea, 'nouveau-mdp-1')).status).toBe(200);
  });

  it('change l’adresse e-mail avec le mot de passe', async () => {
    expect((await call(lea, 'POST', '/api/me/email', { email: `${noah.username}@test.local`, password: 'nouveau-mdp-1' })).status).toBe(409);
    const ok = await call<Me>(lea, 'POST', '/api/me/email', { email: 'lea.nouvelle@test.local', password: 'nouveau-mdp-1' });
    expect(ok.body.email).toBe('lea.nouvelle@test.local');
  });

  it('exporte ses données en zip', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me/export', headers: { cookie: lea.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    const body = res.rawPayload;
    expect(body.subarray(0, 2).toString()).toBe('PK');
    for (const name of ['profil.json', 'posts.json', 'messages.json', 'medias/']) expect(body.includes(Buffer.from(name))).toBe(true);
  });

  it('supprime le compte, ses données et ses fichiers', async () => {
    const tom = await makeUser('tom');
    const m = await upload(tom, '/api/media', await jpeg('#123456'));
    const [row] = await db.execute<{ path: string }>(sql`select path from media where id = ${m.body.id}`);
    expect(fs.existsSync(path.join(mediaDir, row.path))).toBe(true);
    expect((await call(tom, 'DELETE', '/api/me', { password: 'motdepasse1', confirm: 'oui' })).status).toBe(400);
    expect((await call(tom, 'DELETE', '/api/me', { password: 'faux', confirm: 'SUPPRIMER' })).status).toBe(403);
    expect((await call(tom, 'DELETE', '/api/me', { password: 'motdepasse1', confirm: 'SUPPRIMER' })).status).toBe(200);
    expect((await call(tom, 'GET', '/api/auth/me')).status).toBe(401);
    expect(fs.existsSync(path.join(mediaDir, row.path))).toBe(false);
    const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from users where id = ${tom.id}`);
    expect(n).toBe(0);
  });
});
