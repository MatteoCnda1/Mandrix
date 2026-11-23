/** Côté le plus long gardé avant l'envoi : le serveur ne garde de toute façon pas plus grand. */
export const UPLOAD_MAX_SIDE = 2048;
/** En dessous, la photo part telle quelle (déjà légère). */
const SMALL = 700 * 1024;

/**
 * Réduit une photo avant l'envoi (#78) : 2048 px au plus, JPEG qualité 0,85 (PNG gardé en PNG pour
 * la transparence). Orientation EXIF appliquée, métadonnées (dont la position GPS) retirées.
 * En cas d'échec (format non décodable…), le fichier d'origine part sans changement.
 */
export async function shrinkImage(file: Blob, maxSide = UPLOAD_MAX_SIDE, quality = 0.85): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < SMALL || typeof createImageBitmap !== 'function') return file;
  let bmp: ImageBitmap | null = null;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const png = file.type === 'image/png';
    // Déjà à la bonne taille : un PNG reste tel quel, une grosse photo est seulement recompressée.
    if (scale === 1 && png) return file;
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, png ? 'image/png' : 'image/jpeg', quality));
    return out && out.size < file.size ? out : file;
  } catch {
    return file;
  } finally {
    bmp?.close();
  }
}

/** Nom de fichier accordé au nouveau format (« IMG_1234.HEIC » → « IMG_1234.jpg »). */
export function renameFor(blob: Blob, name: string) {
  if (blob.type !== 'image/jpeg') return name;
  return /\.(jpe?g)$/i.test(name) ? name : `${name.replace(/\.[^./]+$/, '') || 'photo'}.jpg`;
}
