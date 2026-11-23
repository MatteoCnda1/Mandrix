import { beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/env.js';
import { app, call, register, useApp, type TestUser } from './helpers.js';

useApp();

// Ce fichier teste le parrainage pur : pas de code « maître » ici.
beforeAll(() => {
  env.inviteCode = null;
});

const asUser = (r: { body: { id: string }; cookie: string }, username: string): TestUser => ({ id: r.body.id, username, cookie: r.cookie });

describe('inscription par parrainage', () => {
  let admin: TestUser;
  let sponsor: TestUser;

  it('le premier compte s’inscrit sans code et devient administrateur', async () => {
    expect((await call(null, 'GET', '/api/config')).body.inviteRequired).toBe(false);
    const r = await register('admin_un', undefined);
    expect(r.status).toBe(200);
    expect(r.body.isAdmin).toBe(true);
    admin = asUser(r, 'admin_un');
    expect((await call(null, 'GET', '/api/config')).body.inviteRequired).toBe(true);
  });

  it('refuse ensuite une inscription sans code ou avec un code inconnu', async () => {
    expect((await register('sans_code', undefined)).status).toBe(403);
    const bad = await register('mauvais_code', 'NOPE-0000');
    expect(bad.status).toBe(403);
    expect(bad.body.error).toMatch(/inconnu/);
  });

  it('accepte le code d’un membre (insensible à la casse) et rend parrain et filleul amis', async () => {
    const adminCode = (await call(admin, 'GET', '/api/me/invite')).body.code;
    expect(adminCode).toMatch(/^ADMINUN-[A-Z0-9]{4}$/);
    sponsor = asUser(await register('parrain', adminCode), 'parrain');

    const invite = await call(sponsor, 'GET', '/api/me/invite');
    const filleul = await register('filleul', ` ${invite.body.code.toLowerCase()} `);
    expect(filleul.status).toBe(200);
    expect(filleul.body.isAdmin).toBe(false);

    const friends = await call(asUser(filleul, 'filleul'), 'GET', '/api/friends');
    expect(friends.body.friends.map((f: { username: string }) => f.username)).toEqual(['parrain']);

    const notifs = await call(sponsor, 'GET', '/api/notifications');
    expect(notifs.body.some((n: { type: string }) => n.type === 'invite_joined')).toBe(true);
    expect((await call(sponsor, 'GET', '/api/me/invite')).body.invited).toBe(1);
  });

  it('accepte le code « maître » quand il est configuré', async () => {
    env.inviteCode = 'MAITRE-42';
    expect((await register('par_maitre', 'maitre-42')).status).toBe(200);
    env.inviteCode = null;
  });

  it('refuse un pseudo ou un e-mail déjà pris', async () => {
    const adminCode = (await call(admin, 'GET', '/api/me/invite')).body.code;
    expect((await register('parrain', adminCode)).status).toBe(409);
  });
});

describe('connexion', () => {
  it('connecte par pseudo ou e-mail et refuse un mauvais mot de passe', async () => {
    const byName = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'parrain', password: 'motdepasse1' } });
    expect(byName.statusCode).toBe(200);
    const byMail = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'PARRAIN@test.local', password: 'motdepasse1' } });
    expect(byMail.statusCode).toBe(200);
    const wrong = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'parrain', password: 'faux-mot' } });
    expect(wrong.statusCode).toBe(401);
  });

  it('protège les routes privées', async () => {
    expect((await call(null, 'GET', '/api/feed')).status).toBe(401);
    expect((await call(null, 'GET', '/api/auth/me')).status).toBe(401);
  });
});
