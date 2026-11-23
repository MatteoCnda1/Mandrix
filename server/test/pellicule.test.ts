import type { PelliculeState, UnpackState } from '@mandrix/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from '../src/db/index.js';
import { nextReveal } from '../src/lib/week.js';
import { call, jpeg, makeUser, upload, useApp, type TestUser } from './helpers.js';

useApp();

let lea: TestUser;

beforeAll(async () => {
  lea = await makeUser('lea');
});

describe('La Pellicule', () => {
  it('scelle les photos jusqu’au déballage, même pour leur auteur', async () => {
    const res = await upload<PelliculeState>(lea, '/api/pellicule/shots', await jpeg('#FF8A5C'));
    expect(res.status).toBe(200);
    expect(res.body.mine.total).toBe(1);
    expect(res.body.nextRevealAt).toBe(nextReveal().toISOString());
    const [shot] = await sql<{ media_id: string }[]>`select media_id from shots limit 1`;
    expect((await call(lea, 'GET', `/media/${shot.media_id}`)).status).toBe(404);
  });

  it('ne crée pas de doublon quand l’appareil renvoie la même photo', async () => {
    const fields = { clientId: 'appareil-1', takenAt: new Date().toISOString() };
    await upload(lea, '/api/pellicule/shots', await jpeg(), fields);
    const again = await upload<PelliculeState>(lea, '/api/pellicule/shots', await jpeg(), fields);
    expect(again.body.mine.total).toBe(2);
  });

  it('garde l’heure réelle d’une photo prise hors ligne', async () => {
    const takenAt = new Date(Date.now() - 2 * 3600_000).toISOString();
    await upload(lea, '/api/pellicule/shots', await jpeg(), { clientId: 'hors-ligne', takenAt });
    const [row] = await sql<{ taken_at: Date }[]>`select taken_at from shots where client_id = 'hors-ligne'`;
    expect(new Date(row.taken_at).toISOString()).toBe(takenAt);
  });

  it('marque « pile à l’heure » une photo prise pendant le Moment Mandrix', async () => {
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    await sql`insert into settings (key, value) values (${`moment:${day}`}, ${new Date(Date.now() - 60_000).toISOString()})
      on conflict (key) do update set value = excluded.value`;
    const state = (await call<PelliculeState>(lea, 'GET', '/api/pellicule')).body;
    expect(state.moment).not.toBeNull();
    await upload(lea, '/api/pellicule/shots', await jpeg(), { clientId: 'moment' });
    const [row] = await sql<{ on_time: boolean }[]>`select on_time from shots where client_id = 'moment'`;
    expect(row.on_time).toBe(true);
  });

  it('refuse l’album d’une semaine pas encore déballée', async () => {
    const res = await call(lea, 'GET', `/api/pellicule/archive?revealAt=${encodeURIComponent(nextReveal().toISOString())}&scope=all`);
    expect(res.status).toBe(403);
  });

  it('déballe la semaine passée et propose l’album en zip', async () => {
    const past = new Date(nextReveal().getTime() - 7 * 86400_000);
    await sql`update shots set reveal_at = ${past.toISOString()}::timestamptz`;
    await sql`update media set sealed_until = ${past.toISOString()}::timestamptz where id in (select media_id from shots)`;

    const unpack = (await call<UnpackState>(lea, 'GET', '/api/pellicule/unpack')).body;
    expect(unpack.revealed?.count).toBe(4);
    expect(unpack.revealed?.photos.some((p) => p.onTime)).toBe(true);
    const media = await call(lea, 'GET', unpack.revealed!.photos[0].media.url);
    expect(media.status).toBe(200);

    const zip = await call(lea, 'GET', `/api/pellicule/archive?revealAt=${encodeURIComponent(past.toISOString())}&scope=mine`);
    expect(zip.status).toBe(200);
    expect(zip.raw.headers['content-type']).toBe('application/zip');
    expect(zip.raw.rawPayload.subarray(0, 2).toString()).toBe('PK');
  });
});
