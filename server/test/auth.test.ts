import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from '../src/db/index.js';
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

  it('le premier compte s’inscrit sans code et devient administrateur et parrain', async () => {
    expect((await call(null, 'GET', '/api/config')).body.inviteRequired).toBe(false);
    const r = await register('admin_un', undefined);
    expect(r.status).toBe(200);
    expect(r.body.isAdmin).toBe(true);
    expect(r.body.canInvite).toBe(true);
    admin = asUser(r, 'admin_un');
    expect((await call(null, 'GET', '/api/config')).body.inviteRequired).toBe(true);
  });

  it('refuse ensuite une inscription sans code ou avec un code inconnu', async () => {
    expect((await register('sans_code', undefined)).status).toBe(403);
    const bad = await register('mauvais_code', 'NOPE-0000');
    expect(bad.status).toBe(403);
    expect(bad.body.error).toMatch(/inconnu/);
  });

  it('accepte le code d’un parrain (insensible à la casse) et rend parrain et filleul amis', async () => {
    const adminCode = (await call(admin, 'GET', '/api/me/invite')).body.code;
    expect(adminCode).toMatch(/^ADMINUN-[A-Z0-9]{4}$/);
    const r = await register('parrain', adminCode);
    expect(r.body.canInvite).toBe(false);
    sponsor = asUser(r, 'parrain');
    // Un nouveau membre ne parraine pas d'office : pas de code tant qu'on ne l'autorise pas (CLI `invite parrain on`).
    const refused = await call(sponsor, 'GET', '/api/me/invite');
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(/réservé/);
    await sql`update users set can_invite = true where id = ${sponsor.id}`;
    expect((await call(sponsor, 'GET', '/api/auth/me')).body.canInvite).toBe(true);

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

  it('refuse le code d’un membre qui ne parraine plus ou qui est suspendu', async () => {
    const code = (await call(sponsor, 'GET', '/api/me/invite')).body.code as string;
    // Droit retiré, ancien code encore en base : il ne fait plus entrer personne.
    await sql`update users set can_invite = false where id = ${sponsor.id}`;
    const revoked = await register('trop_tard', code);
    expect(revoked.status).toBe(403);
    expect(revoked.body.error).toMatch(/inconnu/);
    expect((await call(sponsor, 'GET', '/api/me/invite')).status).toBe(403);
    // Parrain suspendu : son code est refusé aussi.
    await sql`update users set can_invite = true, suspended_at = now() where id = ${sponsor.id}`;
    expect((await register('trop_tard', code)).status).toBe(403);
    await sql`update users set suspended_at = null where id = ${sponsor.id}`;
    expect((await register('trop_tard', code)).status).toBe(200);
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
