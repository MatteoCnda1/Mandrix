import { beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/env.js';
import { befriend, call, makeUser, useApp, type TestUser } from './helpers.js';

// Limites anti-spam actives pour ce fichier seulement (lues à la construction de l'app).
env.spamLimits = true;
useApp();

let lea: TestUser, noah: TestUser;

beforeAll(async () => {
  [lea, noah] = await Promise.all(['lea', 'noah'].map(makeUser));
  await befriend(lea, noah);
});

describe('anti-spam (#53)', () => {
  it('bloque au-delà de 30 messages par minute, par compte', async () => {
    const conv = (await call(lea, 'POST', '/api/conversations', { userId: noah.id })).body.id;
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++) statuses.push((await call(lea, 'POST', `/api/conversations/${conv}/messages`, { text: `spam ${i}` })).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    const blocked = await call(lea, 'POST', `/api/conversations/${conv}/messages`, { text: 'encore' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/^Doucement/);
    // Noah n'est pas concerné.
    expect((await call(noah, 'POST', `/api/conversations/${conv}/messages`, { text: 'Ça va ?' })).status).toBe(200);
  });
});
