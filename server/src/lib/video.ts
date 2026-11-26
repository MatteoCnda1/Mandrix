import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { and, eq, isNull, or } from 'drizzle-orm';
import sharp from 'sharp';
import { db, schema } from '../db/index.js';
import { mediaDir } from '../env.js';
import { emitToUser } from '../realtime/io.js';

// Transcodage des vidéos (HEVC/MOV d'iPhone → MP4 H.264 lisible partout) et miniatures.
// Une seule vidéo à la fois pour ménager le processeur du homelab.

const abs = (rel: string) => path.join(mediaDir, rel);

export function run(cmd: string, args: string[], timeoutMs = 30 * 60_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      return resolve({ code: -1, stdout, stderr: 'spawn failed' });
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)));
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${cmd} introuvable` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

let ffmpegOk: boolean | null = null;
export async function hasFfmpeg() {
  if (ffmpegOk === null) ffmpegOk = (await run('ffmpeg', ['-version'], 10_000)).code === 0;
  return ffmpegOk;
}

export async function probe(file: string) {
  const r = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], 60_000);
  try {
    const j = JSON.parse(r.stdout) as { streams?: { width?: number; height?: number }[]; format?: { duration?: string } };
    const d = Number(j.format?.duration);
    return { width: j.streams?.[0]?.width ?? null, height: j.streams?.[0]?.height ?? null, duration: Number.isFinite(d) ? Math.round(d * 10) / 10 : null };
  } catch {
    return { width: null, height: null, duration: null };
  }
}

/** Extrait une image de la vidéo et l'enregistre en WebP. */
async function makePoster(videoAbs: string, posterAbs: string, duration: number | null) {
  const at = duration && duration > 1 ? Math.min(1, duration / 3) : 0;
  const tmp = `${posterAbs}.png`;
  const r = await run('ffmpeg', ['-y', '-ss', String(at), '-i', videoAbs, '-frames:v', '1', tmp], 120_000);
  if (r.code !== 0) return false;
  try {
    await sharp(tmp).resize({ width: 720, height: 720, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toFile(posterAbs);
    return true;
  } catch {
    return false;
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

type MediaRow = typeof schema.media.$inferSelect;

async function transcode(m: MediaRow) {
  const src = abs(m.sourcePath!);
  const out = abs(m.path);
  const tmp = `${out}.part.mp4`;
  const r = await run('ffmpeg', [
    '-y', '-i', src,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    // Côté le plus long limité à 1280 px, 30 images/s max ; l'orientation de l'iPhone est appliquée automatiquement.
    '-vf', "scale=w='if(gt(iw,ih),min(1280,iw),-2)':h='if(gt(iw,ih),-2,min(1280,ih))'",
    '-fpsmax', '30',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-movflags', '+faststart', '-max_muxing_queue_size', '1024',
    tmp,
  ]);
  if (r.code !== 0) {
    await fs.rm(tmp, { force: true });
    throw new Error(`ffmpeg: ${r.stderr.split('\n').filter(Boolean).slice(-2).join(' ')}`);
  }
  await fs.rename(tmp, out);
}

async function processVideo(id: string) {
  const [m] = await db.select().from(schema.media).where(eq(schema.media.id, id)).limit(1);
  if (!m || m.kind !== 'video') return;
  const posterRel = m.path.replace(/\.[^.]+$/, '') + '.poster.webp';

  if (m.sourcePath) {
    try {
      if (!(await hasFfmpeg())) throw new Error('ffmpeg absent');
      await transcode(m);
      const info = await probe(abs(m.path));
      const poster = await makePoster(abs(m.path), abs(posterRel), info.duration);
      const { size } = await fs.stat(abs(m.path));
      await db
        .update(schema.media)
        .set({ status: 'ready', mime: 'video/mp4', sourcePath: null, posterPath: poster ? posterRel : null, width: info.width, height: info.height, duration: info.duration, size })
        .where(eq(schema.media.id, id));
      await fs.rm(abs(m.sourcePath), { force: true });
    } catch (err) {
      // Échec : on garde la vidéo d'origine pour ne rien perdre.
      console.error('[video] transcodage impossible', id, (err as Error).message);
      const ext = path.extname(m.sourcePath).toLowerCase();
      const mime = ext === '.mov' ? 'video/quicktime' : ext === '.webm' ? 'video/webm' : 'video/mp4';
      const info = await probe(abs(m.sourcePath));
      const poster = (await hasFfmpeg()) ? await makePoster(abs(m.sourcePath), abs(posterRel), info.duration) : false;
      await db
        .update(schema.media)
        .set({ status: 'failed', path: m.sourcePath, sourcePath: null, mime, posterPath: poster ? posterRel : null, width: info.width, height: info.height, duration: info.duration })
        .where(eq(schema.media.id, id));
    }
  } else if (!m.posterPath && (await hasFfmpeg())) {
    // Vidéo plus ancienne : on ajoute seulement la miniature et la durée.
    const info = await probe(abs(m.path));
    const poster = await makePoster(abs(m.path), abs(posterRel), info.duration);
    await db
      .update(schema.media)
      .set({ posterPath: poster ? posterRel : null, duration: info.duration, width: m.width ?? info.width, height: m.height ?? info.height })
      .where(eq(schema.media.id, id));
    if (!poster) return;
  } else return;

  emitToUser(m.ownerId, 'media:ready', id);
}

/**
 * Convertit un message vocal en AAC mono (.m4a) — format lu par Safari, Chrome et Firefox.
 * Synchrone (quelques centaines de ms pour un vocal) : le message est jouable dès l'envoi.
 */
export async function transcodeVoice(srcAbs: string, outAbs: string): Promise<{ ok: boolean; duration: number | null }> {
  if (!(await hasFfmpeg())) return { ok: false, duration: null };
  const r = await run('ffmpeg', ['-y', '-i', srcAbs, '-vn', '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-ar', '44100', '-movflags', '+faststart', outAbs], 120_000);
  if (r.code !== 0) {
    await fs.rm(outAbs, { force: true });
    return { ok: false, duration: (await probe(srcAbs)).duration };
  }
  return { ok: true, duration: (await probe(outAbs)).duration };
}

const queue: string[] = [];
let running = false;

export function enqueueVideo(id: string) {
  if (!queue.includes(id)) queue.push(id);
  void pump();
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const id = queue.shift()!;
    try {
      await processVideo(id);
    } catch (err) {
      console.error('[video]', id, err);
    }
  }
  running = false;
}

/** Au démarrage : reprend les transcodages interrompus et ajoute les miniatures manquantes. */
export async function resumeVideoQueue() {
  const rows = await db
    .select({ id: schema.media.id })
    .from(schema.media)
    .where(
      and(
        eq(schema.media.kind, 'video'),
        or(eq(schema.media.status, 'processing'), and(isNull(schema.media.posterPath), eq(schema.media.status, 'ready'))),
      ),
    );
  for (const r of rows) enqueueVideo(r.id);
}
