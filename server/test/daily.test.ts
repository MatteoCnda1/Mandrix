import type { DailyState, Post, SeasonState } from '@mandrix/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDaily, drawDaily, parisTime } from '../src/lib/daily.js';
import { befriend, call, jpeg, makeUser, upload, useApp, type TestUser } from './helpers.js';

useApp();

// Un jour fixe : on avance l'horloge (Date seulement) pour passer de l'écriture au vote puis aux résultats.
const DAY = '2026-06-15';
const at = (day: string, hour: number) => vi.setSystemTime(parisTime(day, hour));

let lea: TestUser, noah: TestUser, maya: TestUser;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(DAY, 7);
  [lea, noah, maya] = await Promise.all(['lea', 'noah', 'maya'].map(makeUser));
  await befriend(lea, noah);
  const m = await upload(lea, '/api/media', await jpeg('#7BD389'));
  await call<Post>(lea, 'POST', '/api/posts', { kind: 'photo', mediaId: m.body.id, pool: 'public' });
});

afterAll(() => vi.useRealTimers());

const daily = async (u: TestUser) => (await call<DailyState>(u, 'GET', '/api/daily')).body;

describe('mème du jour', () => {
  it('rien avant le tirage, puis une image du pool public', async () => {
    expect((await daily(lea)).today).toBeNull();
    expect((await call(lea, 'PUT', '/api/daily/caption', { text: 'Trop tôt' })).status).toBe(404);
    at(DAY, 8);
    expect(await drawDaily(DAY, false)).toBeTruthy();
    // Deuxième tirage le même jour : sans effet.
    const again = await drawDaily(DAY, false);
    expect(again?.day).toBe(DAY);
    const d = await daily(lea);
    expect(d.today).toMatchObject({ day: DAY, phase: 'caption', participants: 0, myCaption: null });
  });

  it('une légende par personne, modifiable jusqu’aux votes', async () => {
    at(DAY, 10);
    await call(lea, 'PUT', '/api/daily/caption', { text: 'Quand le lundi commence' });
    const edited = (await call(lea, 'PUT', '/api/daily/caption', { text: 'Quand le café ne suffit plus' })).body;
    expect(edited).toMatchObject({ myCaption: 'Quand le café ne suffit plus', participants: 1, captions: [] });
    await call(noah, 'PUT', '/api/daily/caption', { text: 'Moi en réunion' });
    await call(maya, 'PUT', '/api/daily/caption', { text: 'Le regard du chef' });
    expect((await call(noah, 'POST', '/api/daily/vote', { captionId: '00000000-0000-4000-8000-000000000000' })).status).toBe(409);
  });

  it('vote anonyme le soir, pas pour soi-même', async () => {
    at(DAY, 19);
    expect((await call(lea, 'PUT', '/api/daily/caption', { text: 'Trop tard' })).status).toBe(409);
    const d = (await daily(noah)).today!;
    expect(d.phase).toBe('vote');
    expect(d.captions).toHaveLength(3);
    expect(d.captions.every((c) => c.user === null && c.votes === null)).toBe(true);
    const mine = d.captions.find((c) => c.mine)!;
    const leas = d.captions.find((c) => c.text.startsWith('Quand'))!;
    expect((await call(noah, 'POST', '/api/daily/vote', { captionId: mine.id })).status).toBe(400);
    expect((await call(noah, 'POST', '/api/daily/vote', { captionId: leas.id })).body.myVote).toBe(leas.id);
    await call(maya, 'POST', '/api/daily/vote', { captionId: leas.id });
    await call(lea, 'POST', '/api/daily/vote', { captionId: mine.id });
  });

  it('résultats le lendemain et points de saison', async () => {
    at('2026-06-16', 0);
    await closeDaily(DAY);
    await closeDaily(DAY); // idempotent
    at('2026-06-16', 9);
    const y = (await daily(maya)).yesterday!;
    expect(y.phase).toBe('closed');
    expect(y.captions[0]).toMatchObject({ text: 'Quand le café ne suffit plus', votes: 2, winner: true, user: { id: lea.id } });
    expect(y.captions.map((c) => c.votes)).toEqual([2, 1, 0]);

    const season = (await call<SeasonState>(maya, 'GET', '/api/season?month=2026-06')).body;
    expect(season.ranking[0]).toMatchObject({ user: { id: lea.id }, points: 2 * 50 + 100, wins: 1 });
    expect(season.ranking.find((e) => e.user.id === noah.id)?.points).toBe(50);
    expect(season.ranking.some((e) => e.user.id === maya.id)).toBe(false);
  });
});
