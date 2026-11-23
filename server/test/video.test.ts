import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MediaRef } from '@mandrix/shared';
import { describe, expect, it } from 'vitest';
import { sql } from '../src/db/index.js';
import { call, makeUser, upload, useApp, wait } from './helpers.js';

useApp();

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe.skipIf(!hasFfmpeg)('transcodage vidéo', () => {
  it('convertit une vidéo HEVC d’iPhone en MP4 H.264 avec miniature et durée', async () => {
    const src = path.join(os.tmpdir(), `mandrix-hevc-${process.pid}.mov`);
    const gen = spawnSync('ffmpeg', [
      '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=60:duration=2',
      '-f', 'lavfi', '-i', 'sine=duration=2',
      '-c:v', 'libx265', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src,
    ]);
    expect(gen.status).toBe(0);

    const lea = await makeUser('lea');
    const up = await upload<MediaRef>(lea, '/api/media', { name: 'iphone.mov', type: 'video/quicktime', data: fs.readFileSync(src) });
    fs.rmSync(src, { force: true });
    expect(up.status).toBe(200);
    expect(up.body.processing).toBe(true);
    expect((await call(lea, 'GET', up.body.url)).status).toBe(404);

    let row: { status: string; mime: string; duration: number | null; width: number | null; height: number | null } | undefined;
    for (let i = 0; i < 120; i++) {
      [row] = await sql<NonNullable<typeof row>[]>`select status, mime, duration, width, height from media where id = ${up.body.id}`;
      if (row.status !== 'processing') break;
      await wait(500);
    }
    expect(row).toMatchObject({ status: 'ready', mime: 'video/mp4', width: 720, height: 1280 });
    expect(row!.duration).toBeGreaterThan(1.5);

    const video = await call(lea, 'GET', up.body.url);
    expect(video.status).toBe(200);
    expect(video.raw.headers['content-type']).toBe('video/mp4');
    const poster = await call(lea, 'GET', `${up.body.url}/poster`);
    expect(poster.status).toBe(200);
    expect(poster.raw.headers['content-type']).toBe('image/webp');
  }, 90_000);
});
