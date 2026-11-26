import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fmtSeconds, videoTooLong, type MediaRef } from '@mandrix/shared';
import { describe, expect, it } from 'vitest';
import { call, makeUser, upload, useApp } from './helpers.js';

useApp();

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

/** Petite vidéo de test (64 × 64, 1 image par seconde) de la durée voulue. */
function clip(seconds: number) {
  const file = path.join(os.tmpdir(), `mandrix-clip-${process.pid}-${seconds}.mp4`);
  const gen = spawnSync('ffmpeg', [
    '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=64x64:rate=1:duration=${seconds}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file,
  ]);
  expect(gen.status).toBe(0);
  const data = fs.readFileSync(file);
  fs.rmSync(file, { force: true });
  return { name: `clip-${seconds}.mp4`, type: 'video/mp4', data };
}

describe('durée des vidéos', () => {
  it('écrit les durées et les raisons en français', () => {
    expect(fmtSeconds(45)).toBe('45 s');
    expect(fmtSeconds(180)).toBe('3 min');
    expect(fmtSeconds(65)).toBe('1 min 05 s');
    expect(videoTooLong(180, 'post')).toBeNull();
    expect(videoTooLong(null, 'post')).toBeNull();
    expect(videoTooLong(190, 'post')).toBe('Vidéo trop longue (3 min 10 s) : 3 min maximum.');
    expect(videoTooLong(70, 'story')).toBe('Vidéo trop longue pour une story (1 min 10 s) : 1 min maximum. Publie-la plutôt en post.');
  });
});

describe.skipIf(!hasFfmpeg)('vidéos trop longues refusées', () => {
  it('refuse l’envoi d’une vidéo de plus de 3 minutes, avec la raison', async () => {
    const u = await makeUser('longue');
    const res = await upload<{ error: string }>(u, '/api/media', clip(190));
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('Vidéo trop longue (3 min 10 s) : 3 min maximum.');
  });

  it('accepte une vidéo d’1 min 10 en post, pas en story', async () => {
    const u = await makeUser('story');
    const m = await upload<MediaRef>(u, '/api/media', clip(70));
    expect(m.status).toBe(200);
    expect(m.body.duration).toBe(70);
    const story = await call<{ error: string }>(u, 'POST', '/api/stories', { mediaId: m.body.id });
    expect(story.status).toBe(400);
    expect(story.body.error).toMatch(/trop longue pour une story \(1 min 10 s\)/);
    expect((await call(u, 'POST', '/api/posts', { kind: 'video', mediaId: m.body.id })).status).toBe(200);
    const short = await upload<MediaRef>(u, '/api/media', clip(20));
    expect((await call(u, 'POST', '/api/stories', { mediaId: short.body.id })).status).toBe(200);
  });
});
