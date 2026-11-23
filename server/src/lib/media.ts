import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { MultipartFile } from '@fastify/multipart';
import type { MediaRef } from '@mandrix/shared';
import sharp, { type OutputInfo } from 'sharp';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { mediaDir } from '../env.js';
import { fail } from './http.js';
import { enqueueVideo, transcodeVoice } from './video.js';

/**
 * Condition SQL « ce média sert encore » (post, carrousel, sondage, story récente, Pellicule, pool, mème,
 * avatar, photo de groupe, message). Partagée par le ménage nocturne et la suppression d'une pièce jointe.
 */
export function mediaReferenced(id: SQL) {
  return sql`(
    exists (select 1 from posts p where p.media_id = ${id})
    or exists (select 1 from post_media pm where pm.media_id = ${id})
    or exists (select 1 from poll_options o where o.media_id = ${id})
    or exists (select 1 from stories s where s.media_id = ${id} and s.expires_at > now() - interval '2 days')
    or exists (select 1 from shots s where s.media_id = ${id})
    or exists (select 1 from pool_items pi where pi.media_id = ${id})
    or exists (select 1 from memes mm where mm.media_id = ${id})
    or exists (select 1 from users u where u.avatar_media_id = ${id})
    or exists (select 1 from conversations c where c.photo_media_id = ${id})
    or exists (select 1 from messages msg where msg.meta->'media'->>'id' = (${id})::text)
    or exists (select 1 from messages msg where msg.media_id = ${id})
    or exists (select 1 from daily_memes d where d.media_id = ${id})
  )`;
}

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
  /** Largeurs des variantes réduites (photos). */
  variants?: number[] | null;
}

/** Largeurs des variantes WebP générées pour chaque photo (miniatures, fil, plein écran). */
export const VARIANT_WIDTHS = [360, 720, 1280];

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
    srcSet:
      m.kind === 'image' && m.variants?.length && m.width
        ? [...m.variants.map((w) => `/media/${m.id}?w=${w} ${w}w`), `/media/${m.id} ${m.width}w`].join(', ')
        : null,
  };
}

/** Génère les variantes réduites d'une photo WebP déjà enregistrée ; renvoie les largeurs créées. */
export async function makeVariants(rel: string, width: number | null): Promise<number[]> {
  if (!width) return [];
  const made: number[] = [];
  for (const w of VARIANT_WIDTHS) {
    if (w >= width * 0.9) break;
    try {
      await sharp(path.join(mediaDir, rel)).resize({ width: w }).webp({ quality: 76 }).toFile(path.join(mediaDir, variantPath(rel, w)));
      made.push(w);
    } catch {
      break;
    }
  }
  return made;
}

/** Photos plus anciennes sans variantes : traitées en tâche de fond, par lots. */
export async function backfillVariants() {
  for (;;) {
    const rows = await db
      .select({ id: schema.media.id, path: schema.media.path, width: schema.media.width })
      .from(schema.media)
      .where(and(eq(schema.media.kind, 'image'), isNull(schema.media.variants), eq(schema.media.mime, 'image/webp')))
      .limit(20);
    if (rows.length === 0) return;
    for (const r of rows) {
      const variants = await makeVariants(r.path, r.width).catch(() => []);
      await db.update(schema.media).set({ variants }).where(eq(schema.media.id, r.id));
    }
  }
}

/** Colonnes SQL à sélectionner (alias de table `m`) pour construire un MediaRef. */
export const MEDIA_SQL_COLUMNS = `m.status as "mediaStatus", m.duration as "mediaDuration", (m.poster_path is not null) as "mediaPoster", m.variants as "mediaVariants"`;

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
    let out: { data: Buffer; info: OutputInfo };
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
    // Les photos scellées de la Pellicule n'ont pas besoin de miniatures avant le déballage : faites quand même, c'est rapide.
    const variants = await makeVariants(relPath, out.info.width);
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
        variants,
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

/** Chemin d'une variante réduite d'une photo (`…/id.webp` → `…/id.w720.webp`). */
export const variantPath = (rel: string, width: number) => rel.replace(/\.webp$/, `.w${width}.webp`);

export async function deleteMediaFile(relPath: string) {
  await fs.rm(path.join(mediaDir, relPath), { force: true });
}
