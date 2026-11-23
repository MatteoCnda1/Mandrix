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

const VIDEO_MIMES: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
};

export function mediaRef(m: { id: string; kind: string; width?: number | null; height?: number | null } | null | undefined): MediaRef | null {
  if (!m || !m.id) return null;
  return {
    id: m.id,
    url: `/media/${m.id}`,
    kind: m.kind === 'video' ? 'video' : 'image',
    width: m.width ?? null,
    height: m.height ?? null,
  };
}

interface SaveOpts {
  accept?: 'image' | 'video' | 'any';
  sealedUntil?: Date | null;
  maxSide?: number;
}

export async function saveUpload(file: MultipartFile, ownerId: string, opts: SaveOpts = {}) {
  const accept = opts.accept ?? 'any';
  const mime = file.mimetype.toLowerCase();
  const isImage = mime.startsWith('image/');
  const isVideo = mime in VIDEO_MIMES;
  if ((accept === 'image' && !isImage) || (accept === 'video' && !isVideo) || (!isImage && !isVideo)) {
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

  const relPath = path.join(rel, `${id}${VIDEO_MIMES[mime]}`);
  const abs = path.join(mediaDir, relPath);
  await pipeline(file.file, createWriteStream(abs));
  if (file.file.truncated) {
    await fs.rm(abs, { force: true });
    fail(413, 'Fichier trop volumineux');
  }
  const { size } = await fs.stat(abs);
  const [row] = await db
    .insert(schema.media)
    .values({ id, ownerId, kind: 'video', mime, path: relPath, width: null, height: null, size, sealedUntil: opts.sealedUntil ?? null })
    .returning();
  return row;
}

export async function deleteMediaFile(relPath: string) {
  await fs.rm(path.join(mediaDir, relPath), { force: true });
}
