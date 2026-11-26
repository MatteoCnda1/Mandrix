import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MusicTrack } from '@mandrix/shared';
import sharp from 'sharp';
import { db, schema } from '../db/index.js';
import { mediaDir } from '../env.js';
import { fail } from './http.js';
import { hasFfmpeg, run } from './video.js';

// Bibliothèque musicale Plex (stories en musique). Le jeton reste sur le serveur : les téléphones ne
// reçoivent que des titres, des pochettes réduites et des extraits audio découpés par Mandrix.
// Réglages lus à l'appel (PLEX_URL, PLEX_TOKEN, PLEX_MUSIC_SECTION facultatif).

interface PlexTrack {
  ratingKey: string;
  type?: string;
  title: string;
  grandparentTitle?: string;
  originalTitle?: string;
  parentTitle?: string;
  thumb?: string;
  parentThumb?: string;
  grandparentThumb?: string;
  duration?: number;
  librarySectionID?: number | string;
  Media?: { Part?: { key: string }[] }[];
}

const conf = () => ({
  url: (process.env.PLEX_URL ?? '').replace(/\/$/, ''),
  token: process.env.PLEX_TOKEN ?? '',
  section: process.env.PLEX_MUSIC_SECTION ?? '',
});

export const plexEnabled = () => {
  const c = conf();
  return !!c.url && !!c.token;
};

async function plex<T>(pathAndQuery: string, timeoutMs = 8000): Promise<T> {
  const c = conf();
  if (!c.url || !c.token) fail(503, 'Bibliothèque musicale indisponible');
  let res: Response;
  try {
    res = await fetch(`${c.url}${pathAndQuery}`, {
      headers: { Accept: 'application/json', 'X-Plex-Token': c.token },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return fail(503, 'Bibliothèque musicale injoignable pour le moment');
  }
  if (!res.ok) return fail(res.status === 404 ? 404 : 503, res.status === 404 ? 'Titre introuvable' : 'Bibliothèque musicale indisponible');
  return (await res.json()) as T;
}

let sectionCache: { url: string; id: string } | null = null;
/** Section Musique : réglée, sinon la première bibliothèque de type « artiste ». */
async function musicSection(): Promise<string> {
  const c = conf();
  if (c.section) return c.section;
  if (sectionCache?.url === c.url) return sectionCache.id;
  const j = await plex<{ MediaContainer: { Directory?: { key: string; type: string }[] } }>('/library/sections');
  const dir = j.MediaContainer.Directory?.find((d) => d.type === 'artist');
  if (!dir) return fail(503, 'Aucune bibliothèque musicale dans Plex');
  sectionCache = { url: c.url, id: dir.key };
  return dir.key;
}

const toTrack = (t: PlexTrack): MusicTrack => ({
  id: t.ratingKey,
  title: t.title,
  artist: t.originalTitle || t.grandparentTitle || 'Artiste inconnu',
  album: t.parentTitle ?? null,
  duration: Math.round((t.duration ?? 0) / 1000),
  cover: t.thumb || t.parentThumb || t.grandparentThumb ? `/api/music/tracks/${t.ratingKey}/cover` : null,
});

export async function searchTracks(query: string): Promise<MusicTrack[]> {
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];
  const section = await musicSection();
  const j = await plex<{ MediaContainer: { Metadata?: PlexTrack[] } }>(
    `/library/sections/${encodeURIComponent(section)}/search?type=10&limit=30&query=${encodeURIComponent(q)}`,
  );
  return (j.MediaContainer.Metadata ?? []).filter((t) => t.Media?.[0]?.Part?.[0]?.key && t.duration).map(toTrack);
}

/** Un titre de la bibliothèque musicale (et rien d'autre : ni film, ni autre bibliothèque). */
async function trackById(id: string): Promise<PlexTrack> {
  if (!/^\d{1,12}$/.test(id)) return fail(404, 'Titre introuvable');
  const j = await plex<{ MediaContainer: { Metadata?: PlexTrack[] } }>(`/library/metadata/${id}`);
  const t = j.MediaContainer.Metadata?.[0];
  if (!t || t.type !== 'track' || String(t.librarySectionID ?? '') !== String(await musicSection())) return fail(404, 'Titre introuvable');
  return t;
}

export async function trackInfo(id: string): Promise<MusicTrack> {
  return toTrack(await trackById(id));
}

/** Pochette réduite (WebP carré), gardée en mémoire. */
const covers = new Map<string, Buffer>();
export async function trackCover(id: string, size = 160): Promise<Buffer> {
  const key = `${id}:${size}`;
  const hit = covers.get(key);
  if (hit) return hit;
  const t = await trackById(id);
  const thumb = t.thumb || t.parentThumb || t.grandparentThumb;
  if (!thumb) return fail(404, 'Pas de pochette');
  const c = conf();
  const res = await fetch(`${c.url}${thumb}`, { headers: { 'X-Plex-Token': c.token }, signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!res?.ok) return fail(404, 'Pas de pochette');
  // Pochette brute (jamais le transcodeur photo de Plex, qui plante sur certains JPEG).
  const out = await sharp(Buffer.from(await res.arrayBuffer()), { failOn: 'none' }).resize(size, size, { fit: 'cover' }).webp({ quality: 78 }).toBuffer();
  if (covers.size > 400) covers.delete(covers.keys().next().value!);
  covers.set(key, out);
  return out;
}

/** Passage valide d'un titre : longueur 5 à 30 s, dans les limites du morceau. */
function clamp(t: PlexTrack, start: number, length: number) {
  const total = Math.max(1, Math.floor((t.duration ?? 0) / 1000));
  const len = Math.max(5, Math.min(30, Math.round(length), total));
  const from = Math.max(0, Math.min(Math.floor(start), Math.max(0, total - len)));
  return { from, len };
}

/** Découpe un passage avec ffmpeg (lecture du fichier Plex par requêtes partielles, sortie AAC). */
async function cut(t: PlexTrack, start: number, length: number, output: string[]) {
  if (!(await hasFfmpeg())) fail(503, 'Découpage audio indisponible sur ce serveur');
  const part = t.Media?.[0]?.Part?.[0]?.key;
  if (!part) fail(404, 'Fichier du titre introuvable');
  const c = conf();
  const { from, len } = clamp(t, start, length);
  // Jeton passé en en-tête HTTP (jamais dans une adresse ni un journal).
  const args = ['-v', 'error', '-ss', String(from), '-t', String(len), '-headers', `X-Plex-Token: ${c.token}\r\n`, '-i', `${c.url}${part}`, '-vn', '-ac', '2', '-c:a', 'aac', '-b:a', '128k', ...output];
  return { args, from, len };
}

/** Extrait d'écoute (choix du passage) : AAC brut (ADTS), gardé un moment en mémoire. */
const previews = new Map<string, Buffer>();
export async function previewClip(id: string, start: number, length: number): Promise<Buffer> {
  const t = await trackById(id);
  const { from, len } = clamp(t, start, length);
  const key = `${id}:${from}:${len}`;
  const hit = previews.get(key);
  if (hit) return hit;
  const tmp = path.join(mediaDir, 'tmp', `${randomUUID()}.aac`);
  await fs.mkdir(path.dirname(tmp), { recursive: true });
  const { args } = await cut(t, from, len, ['-f', 'adts', '-y', tmp]);
  const r = await run('ffmpeg', args, 60_000);
  const buf = r.code === 0 ? await fs.readFile(tmp).catch(() => null) : null;
  await fs.rm(tmp, { force: true });
  if (!buf?.length) return fail(502, 'Impossible de lire ce passage');
  if (previews.size > 60) previews.delete(previews.keys().next().value!);
  previews.set(key, buf);
  return buf;
}

/**
 * Extrait d'une story : découpé une fois pour toutes et rangé dans Mandrix (la story reste lisible
 * même si Plex est éteint), avec la pochette.
 */
export async function saveStoryClip(ownerId: string, id: string, start: number, length: number) {
  const t = await trackById(id);
  const now = new Date();
  const rel = path.join(String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'));
  await fs.mkdir(path.join(mediaDir, rel), { recursive: true });
  const mediaId = randomUUID();
  const relPath = path.join(rel, `${mediaId}.m4a`);
  const { args, from, len } = await cut(t, start, length, ['-movflags', '+faststart', '-y', path.join(mediaDir, relPath)]);
  const r = await run('ffmpeg', args, 120_000);
  if (r.code !== 0) {
    await fs.rm(path.join(mediaDir, relPath), { force: true });
    return fail(502, 'Impossible de découper ce passage');
  }
  const { size } = await fs.stat(path.join(mediaDir, relPath));
  const [clip] = await db
    .insert(schema.media)
    .values({ id: mediaId, ownerId, kind: 'audio', mime: 'audio/mp4', path: relPath, size, duration: len })
    .returning();
  let coverMediaId: string | null = null;
  try {
    const { saveImageBuffer } = await import('./media.js');
    coverMediaId = (await saveImageBuffer(await trackCover(id, 512), ownerId, { still: true, maxSide: 512 })).id;
  } catch {
    /* pas de pochette : la story s'en passe */
  }
  const info = toTrack(t);
  return { clip, music: { trackId: id, title: info.title, artist: info.artist, album: info.album, coverMediaId, start: from, duration: len } };
}
