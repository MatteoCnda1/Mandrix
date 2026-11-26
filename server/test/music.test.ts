import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig, MediaRef, MusicTrack, StoryGroup } from '@mandrix/shared';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, call, jpeg, makeUser, upload, useApp, type TestUser } from './helpers.js';

useApp();

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const TOKEN = 'jeton-de-test';

/** Faux Plex : une bibliothèque Musique (section 5), un titre d'une minute, un film à refuser. */
function fakePlex(audio: Buffer, cover: Buffer) {
  const track = {
    ratingKey: '42',
    type: 'track',
    title: 'Chanson de test',
    grandparentTitle: 'Le Groupe',
    parentTitle: 'Premier album',
    thumb: '/library/metadata/42/thumb/1',
    duration: 60_000,
    librarySectionID: 5,
    Media: [{ Part: [{ key: '/library/parts/7/1/file.mp3' }] }],
  };
  const json = (res: http.ServerResponse, body: unknown) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  return http.createServer((req, res) => {
    if (req.headers['x-plex-token'] !== TOKEN) {
      res.writeHead(401);
      return res.end();
    }
    const url = new URL(req.url ?? '/', 'http://plex');
    if (url.pathname === '/library/sections') return json(res, { MediaContainer: { Directory: [{ key: '1', type: 'movie' }, { key: '5', type: 'artist' }] } });
    if (url.pathname === '/library/sections/5/search') return json(res, { MediaContainer: { Metadata: url.searchParams.get('query')?.startsWith('chan') ? [track] : [] } });
    if (url.pathname === '/library/metadata/42') return json(res, { MediaContainer: { Metadata: [track] } });
    if (url.pathname === '/library/metadata/99') return json(res, { MediaContainer: { Metadata: [{ ...track, ratingKey: '99', type: 'movie', librarySectionID: 1 }] } });
    if (url.pathname === '/library/metadata/42/thumb/1') {
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      return res.end(cover);
    }
    if (url.pathname === '/library/parts/7/1/file.mp3') {
      // Requêtes partielles, comme Plex (ffmpeg s'en sert pour aller au passage).
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
      const from = m ? Number(m[1]) : 0;
      const to = m && m[2] ? Number(m[2]) : audio.length - 1;
      res.writeHead(m ? 206 : 200, {
        'content-type': 'audio/mpeg',
        'accept-ranges': 'bytes',
        'content-length': to - from + 1,
        ...(m ? { 'content-range': `bytes ${from}-${to}/${audio.length}` } : {}),
      });
      return res.end(audio.subarray(from, to + 1));
    }
    res.writeHead(404);
    res.end();
  });
}

describe.skipIf(!hasFfmpeg)('musique des stories (Plex)', () => {
  let plex: http.Server;
  let u: TestUser;

  beforeAll(async () => {
    const file = path.join(os.tmpdir(), `mandrix-chanson-${process.pid}.mp3`);
    const gen = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=60', '-c:a', 'libmp3lame', '-b:a', '64k', file]);
    if (gen.status !== 0) spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=60', '-c:a', 'aac', '-f', 'adts', file]);
    const audio = fs.readFileSync(file);
    fs.rmSync(file, { force: true });
    const cover = await sharp({ create: { width: 600, height: 600, channels: 3, background: '#cc3366' } }).jpeg().toBuffer();
    plex = fakePlex(audio, cover);
    await new Promise<void>((resolve) => plex.listen(0, '127.0.0.1', resolve));
    const addr = plex.address();
    process.env.PLEX_URL = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    process.env.PLEX_TOKEN = TOKEN;
    u = await makeUser('melomane');
  });

  afterAll(() => {
    delete process.env.PLEX_URL;
    delete process.env.PLEX_TOKEN;
    plex?.close();
  });

  it('cherche dans la bibliothèque musicale et sert les pochettes', async () => {
    expect((await call<AppConfig>(u, 'GET', '/api/config')).body.music).toBe(true);
    const found = (await call<MusicTrack[]>(u, 'GET', '/api/music/search?q=chanson')).body;
    expect(found).toEqual([{ id: '42', title: 'Chanson de test', artist: 'Le Groupe', album: 'Premier album', duration: 60, cover: '/api/music/tracks/42/cover' }]);
    expect((await call<MusicTrack[]>(u, 'GET', '/api/music/search?q=zz')).body).toEqual([]);
    const cover = await app.inject({ method: 'GET', url: '/api/music/tracks/42/cover', headers: { cookie: u.cookie } });
    expect(cover.statusCode).toBe(200);
    expect(cover.headers['content-type']).toBe('image/webp');
    // Pas un titre de la bibliothèque musicale (un film) : introuvable.
    expect((await app.inject({ method: 'GET', url: '/api/music/tracks/99/cover', headers: { cookie: u.cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/music/tracks/../cover', headers: { cookie: u.cookie } })).statusCode).toBe(404);
  });

  it('fait écouter le passage choisi', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/music/tracks/42/preview?start=10&len=15', headers: { cookie: u.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('audio/aac');
    expect(res.rawPayload.length).toBeGreaterThan(2000);
  });

  it('publie une story photo avec l’extrait découpé et gardé dans Mandrix', async () => {
    const photo = (await upload<MediaRef>(u, '/api/media', await jpeg('#3366cc'))).body;
    // Passage demandé trop tard : ramené dans le morceau (45 + 15 = 60 s).
    const created = await call<{ id: string }>(u, 'POST', '/api/stories', { mediaId: photo.id, music: { trackId: '42', start: 55, duration: 15 } });
    expect(created.status).toBe(200);
    const mine = (await call<StoryGroup[]>(u, 'GET', '/api/stories')).body.find((g) => g.user.id === u.id)!;
    const music = mine.stories.at(-1)!.music!;
    expect(music).toMatchObject({ title: 'Chanson de test', artist: 'Le Groupe', duration: 15, clip: { kind: 'audio' }, cover: { kind: 'image' } });
    const clip = await app.inject({ method: 'GET', url: music.clip.url, headers: { cookie: u.cookie } });
    expect(clip.statusCode).toBe(200);
    // Longueur d'extrait non proposée : refusée.
    expect((await call(u, 'POST', '/api/stories', { mediaId: photo.id, music: { trackId: '42', start: 0, duration: 20 } })).status).toBe(400);
    // Pas de musique sans bibliothèque branchée.
    const url = process.env.PLEX_URL;
    delete process.env.PLEX_URL;
    expect((await call<AppConfig>(u, 'GET', '/api/config')).body.music).toBe(false);
    expect((await call(u, 'GET', '/api/music/search?q=chanson')).status).toBe(503);
    expect((await call(u, 'POST', '/api/stories', { mediaId: photo.id, music: { trackId: '42', start: 0, duration: 15 } })).status).toBe(503);
    process.env.PLEX_URL = url;
  });
});
