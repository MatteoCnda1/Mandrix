import fs from 'node:fs/promises';
import path from 'node:path';
import { upsertPoolItem } from '../routes/pool.js';
import { saveImageBuffer } from './media.js';

/** Fichier gardé dans le dossier importé : les images déjà importées ne le sont pas deux fois (relance). */
export const IMPORT_MANIFEST = '.mandrix-import.json';
const IMAGE_RE = /\.(jpe?g|png|gif|webp|avif|heic|heif)$/i;

export interface ImportResult {
  imported: number;
  skipped: number;
  failed: { file: string; error: string }[];
}

/**
 * Importe toutes les images d'un dossier dans le pool de Make It Friends, au nom d'un membre.
 * Même traitement qu'un envoi depuis l'app (WebP, orientation, métadonnées GPS retirées, miniatures).
 */
export async function importPool(dir: string, ownerId: string, scope: 'public' | 'friends', log: (line: string) => void = () => {}): Promise<ImportResult> {
  const manifestPath = path.join(dir, IMPORT_MANIFEST);
  const done: Record<string, string> = JSON.parse(await fs.readFile(manifestPath, 'utf8').catch(() => '{}'));
  const files = (await fs.readdir(dir, { withFileTypes: true }))
    .filter((d) => d.isFile() && IMAGE_RE.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
  const result: ImportResult = { imported: 0, skipped: 0, failed: [] };
  for (const [i, name] of files.entries()) {
    if (done[name]) {
      result.skipped++;
      continue;
    }
    try {
      const media = await saveImageBuffer(await fs.readFile(path.join(dir, name)), ownerId);
      await upsertPoolItem({ mediaId: media.id, ownerId, addedById: ownerId, scope });
      done[name] = media.id;
      await fs.writeFile(manifestPath, JSON.stringify(done, null, 2));
      result.imported++;
      log(`[${i + 1}/${files.length}] ${name}`);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      result.failed.push({ file: name, error });
      log(`[${i + 1}/${files.length}] ${name} : échec (${error})`);
    }
  }
  return result;
}
