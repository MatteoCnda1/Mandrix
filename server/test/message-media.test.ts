import { spawnSync } from 'node:child_process';
import type { Conversation, MediaRef, Message } from '@mandrix/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, befriend, call, jpeg, makeUser, upload, useApp, type TestUser } from './helpers.js';

useApp();

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

let lina: TestUser, tom: TestUser;
let convId: string;

beforeAll(async () => {
  [lina, tom] = await Promise.all(['lina', 'tom'].map(makeUser));
  await befriend(lina, tom);
  convId = (await call(lina, 'POST', '/api/conversations', { userId: tom.id })).body.id;
});

const lastPreview = async (user: TestUser) => (await call<Conversation[]>(user, 'GET', '/api/conversations')).body.find((c) => c.id === convId)?.last?.text;

describe('pièces jointes dans les messages', () => {
  it('refuse un message sans texte ni pièce jointe', async () => {
    expect((await call(lina, 'POST', `/api/conversations/${convId}/messages`, { text: '  ' })).status).toBe(400);
  });

  it('envoie une photo avec une légende', async () => {
    const photo = (await upload<MediaRef>(lina, '/api/media', await jpeg('#F4A62A'))).body;
    const m = (await call<Message>(lina, 'POST', `/api/conversations/${convId}/messages`, { text: 'Regarde ça', mediaId: photo.id })).body;
    expect(m.text).toBe('Regarde ça');
    expect(m.media).toMatchObject({ id: photo.id, kind: 'image' });

    const list = (await call<Message[]>(tom, 'GET', `/api/conversations/${convId}/messages`)).body;
    expect(list.at(-1)?.media?.id).toBe(photo.id);
    expect(await lastPreview(tom)).toBe('Regarde ça');
  });

  it('accepte une photo seule et l’annonce dans la liste', async () => {
    const photo = (await upload<MediaRef>(tom, '/api/media', await jpeg('#2AF4B0'))).body;
    const m = (await call<Message>(tom, 'POST', `/api/conversations/${convId}/messages`, { mediaId: photo.id })).body;
    expect(m.text).toBe('');
    expect(await lastPreview(lina)).toBe('📷 Photo');
  });

  it('refuse le fichier de quelqu’un d’autre', async () => {
    const photo = (await upload<MediaRef>(tom, '/api/media', await jpeg())).body;
    expect((await call(lina, 'POST', `/api/conversations/${convId}/messages`, { mediaId: photo.id })).status).toBe(400);
  });
});

describe.skipIf(!hasFfmpeg)('messages vocaux', () => {
  let voice: MediaRef;

  beforeAll(() => {
    const gen = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'libopus', '-f', 'webm', 'pipe:1'], {
      maxBuffer: 10 * 1024 * 1024,
    });
    if (gen.status !== 0) throw new Error(`ffmpeg : ${gen.stderr}`);
    return upload<MediaRef>(lina, '/api/media', { name: 'vocal.webm', type: 'audio/webm;codecs=opus', data: gen.stdout }).then((r) => {
      expect(r.status).toBe(200);
      voice = r.body;
    });
  });

  it('convertit le vocal en AAC et mesure sa durée', async () => {
    expect(voice.kind).toBe('audio');
    expect(voice.duration).toBeGreaterThan(1.5);
    expect(voice.duration).toBeLessThan(2.5);
    const res = await app.inject({ method: 'GET', url: voice.url, headers: { cookie: tom.cookie, range: 'bytes=0-99' } });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-type']).toContain('audio/mp4');
  });

  it('envoie le vocal et l’annonce avec sa durée', async () => {
    const m = (await call<Message>(lina, 'POST', `/api/conversations/${convId}/messages`, { mediaId: voice.id })).body;
    expect(m.media?.kind).toBe('audio');
    expect(await lastPreview(tom)).toBe('🎤 Message vocal (0:02)');
  });

  it('ne laisse pas publier un vocal en story ni en post', async () => {
    expect((await call(lina, 'POST', '/api/stories', { mediaId: voice.id })).status).toBe(400);
    expect((await call(lina, 'POST', '/api/posts', { kind: 'video', mediaId: voice.id })).status).toBe(400);
  });
});
