import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { MultipartFile } from '@fastify/multipart';
import type { MediaRef } from '@mandrix/shared';
import sharp from 'sharp';
import { db, schema } from '../db/index.js';
import { mediaDir } from '../env.js';
import { fail } from './http.js';
import { enqueueVideo, transcodeVoice } from './video.js';

const VIDEO_MIMES: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
};

// Formats produits par l'enregistreur du navigateur (Safari : mp4/aac, Chrome : webm/opus…).
const AUDIO_MIMES: Record<string, string> = {
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
};

interface MediaLike {
  id: string;
  kind: string;
  width?: number | null;
  height?: number | null;
  status?: string | null;
  duration?: number | null;
  posterPath?: string | null;
  /** Variante des requêtes SQL brutes : la miniature existe-t-elle ? */
  hasPoster?: boolean | null;
}

export function mediaRef(m: MediaLike | null | undefined): MediaRef | null {
  if (!m || !m.id) return null;
  const video = m.kind === 'video';
  return {
    id: m.id,
    url: `/media/${m.id}`,
    kind: video ? 'video' : m.kind === 'audio' ? 'audio' : 'image',
    width: m.width ?? null,
    height: m.height ?? null,
    poster: video && (m.posterPath || m.hasPoster) ? `/media/${m.id}/poster` : null,
    duration: m.duration ?? null,
    processing: m.status === 'processing',
  };
}

/** Colonnes SQL à sélectionner (alias de table `m`) pour construire un MediaRef. */
export const MEDIA_SQL_COLUMNS = `m.status as "mediaStatus", m.duration as "mediaDuration", (m.poster_path is not null) as "mediaPoster"`;

interface SaveOpts {
  accept?: 'image' | 'video' | 'audio' | 'any';
  sealedUntil?: Date | null;
  maxSide?: number;
}

export async function saveUpload(file: MultipartFile, ownerId: string, opts: SaveOpts = {}) {
  const accept = opts.accept ?? 'any';
  // « audio/webm;codecs=opus » → « audio/webm »
  const mime = file.mimetype.toLowerCase().split(';')[0].trim();
  const isImage = mime.startsWith('image/');
  const isVideo = mime in VIDEO_MIMES;
  const isAudio = mime in AUDIO_MIMES;
  if (
    (accept === 'image' && !isImage) ||
    (accept === 'video' && !isVideo) ||
    (accept === 'audio' && !isAudio) ||
    (!isImage && !isVideo && !isAudio)
  ) {
    file.file.resume();
    fail(415, accept === 'video' ? 'Format vidéo non supporté (MP4, WebM ou MOV)' : 'Format de fichier non supporté');
  }

  const id = randomUUID();
  const now = new Date();
  const rel = path.join(String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'));
  await fs.mkdir(path.join(mediaDir, rel), { recursive: true });

  if (isImage) {
    const buf = await file.toBuffer();
    let out: { data: Buffer; info: sharp.OutputInfo };
    try {
      const side = opts.maxSide ?? 2048;
      // rotate() applique l'orientation EXIF ; la sortie WebP ne conserve aucune métadonnée (GPS…).
      out = await sharp(buf, { failOn: 'none' })
        .rotate()
        .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
    } catch {
      return fail(415, 'Image illisible');
    }
    const relPath = path.join(rel, `${id}.webp`);
    await fs.writeFile(path.join(mediaDir, relPath), out.data);
    const [row] = await db
      .insert(schema.media)
      .values({
        id,
        ownerId,
        kind: 'image',
        mime: 'image/webp',
        path: relPath,
        width: out.info.width,
        height: out.info.height,
        size: out.info.size,
        sealedUntil: opts.sealedUntil ?? null,
      })
      .returning();
    return row;
  }

  if (isAudio) {
    const sourceRel = path.join(rel, `${id}.src${AUDIO_MIMES[mime]}`);
    const src = path.join(mediaDir, sourceRel);
    await pipeline(file.file, createWriteStream(src));
    if (file.file.truncated) {
      await fs.rm(src, { force: true });
      fail(413, 'Fichier trop volumineux');
    }
    const outRel = path.join(rel, `${id}.m4a`);
    const voice = await transcodeVoice(src, path.join(mediaDir, outRel));
    // Conversion impossible (ffmpeg absent) : on garde le fichier d'origine.
    const finalRel = voice.ok ? outRel : sourceRel;
    if (voice.ok) await fs.rm(src, { force: true });
    const { size } = await fs.stat(path.join(mediaDir, finalRel));
    const [row] = await db
      .insert(schema.media)
      .values({ id, ownerId, kind: 'audio', mime: voice.ok ? 'audio/mp4' : mime, path: finalRel, size, duration: voice.duration })
      .returning();
    return row;
  }

  // La vidéo d'origine est gardée de côté puis transcodée en MP4 H.264 en arrière-plan.
  const sourceRel = path.join(rel, `${id}.src${VIDEO_MIMES[mime]}`);
  const abs = path.join(mediaDir, sourceRel);
  await pipeline(file.file, createWriteStream(abs));
  if (file.file.truncated) {
    await fs.rm(abs, { force: true });
    fail(413, 'Fichier trop volumineux');
  }
  const { size } = await fs.stat(abs);
  const [row] = await db
    .insert(schema.media)
    .values({
      id,
      ownerId,
      kind: 'video',
      mime: 'video/mp4',
      path: path.join(rel, `${id}.mp4`),
      sourcePath: sourceRel,
      status: 'processing',
      width: null,
      height: null,
      size,
      sealedUntil: opts.sealedUntil ?? null,
    })
    .returning();
  enqueueVideo(id);
  return row;
}

export async function deleteMediaFile(relPath: string) {
  await fs.rm(path.join(mediaDir, relPath), { force: true });
}
