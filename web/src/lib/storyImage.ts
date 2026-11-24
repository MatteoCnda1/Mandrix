// Story en 9:16 : placement de la photo dans le cadre et rendu final en 1080 × 1920.

export const STORY_W = 1080;
export const STORY_H = 1920;

export type StoryFit = 'fill' | 'fit';
export interface StoryView {
  zoom: number;
  x: number;
  y: number;
}
export interface Size {
  w: number;
  h: number;
}

export const ZOOM_MAX = 5;

/** Échelle de base : la photo couvre le cadre (« Remplir ») ou y tient entière (« Ajuster »). */
export function baseScale(img: Size, frame: Size, fit: StoryFit) {
  return fit === 'fill' ? Math.max(frame.w / img.w, frame.h / img.h) : Math.min(frame.w / img.w, frame.h / img.h);
}

/** Garde la photo dans des limites raisonnables : en « Remplir », elle couvre toujours tout le cadre. */
export function clampView(v: StoryView, img: Size, frame: Size, fit: StoryFit): StoryView {
  const zoom = Math.min(ZOOM_MAX, Math.max(1, v.zoom));
  const s = baseScale(img, frame, fit) * zoom;
  const dw = img.w * s;
  const dh = img.h * s;
  const mx = fit === 'fill' ? Math.max(0, (dw - frame.w) / 2) : Math.max(dw, frame.w) / 2;
  const my = fit === 'fill' ? Math.max(0, (dh - frame.h) / 2) : Math.max(dh, frame.h) / 2;
  return { zoom, x: Math.max(-mx, Math.min(mx, v.x)), y: Math.max(-my, Math.min(my, v.y)) };
}

/** Rectangle de la photo dans un cadre donné (coordonnées du cadre). */
export function placement(img: Size, frame: Size, fit: StoryFit, v: StoryView) {
  const s = baseScale(img, frame, fit) * v.zoom;
  const w = img.w * s;
  const h = img.h * s;
  return { left: frame.w / 2 + v.x - w / 2, top: frame.h / 2 + v.y - h / 2, width: w, height: h };
}

/** Décode la photo dans le bon sens (orientation EXIF appliquée). */
export async function decodeImage(src: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(src, { imageOrientation: 'from-image' });
    } catch {
      /* format non décodable ici : on passe par <img> */
    }
  }
  const url = URL.createObjectURL(src);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const sizeOf = (img: ImageBitmap | HTMLImageElement): Size =>
  'naturalWidth' in img ? { w: img.naturalWidth, h: img.naturalHeight } : { w: img.width, h: img.height };

/**
 * Rend la story telle qu'elle apparaît dans le cadre, en 1080 × 1920 (JPEG).
 * « Ajuster » : fond flouté tiré de la photo (agrandie depuis une vignette, sans filtre canvas).
 */
export async function renderStory(img: ImageBitmap | HTMLImageElement, frame: Size, fit: StoryFit, v: StoryView): Promise<Blob> {
  const size = sizeOf(img);
  const canvas = document.createElement('canvas');
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Rendu impossible sur cet appareil');
  ctx.fillStyle = '#0b0f14';
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (fit === 'fit') {
    const tiny = document.createElement('canvas');
    tiny.width = 27;
    tiny.height = 48;
    const t = tiny.getContext('2d');
    if (t) {
      const cover = placement(size, { w: 27, h: 48 }, 'fill', { zoom: 1, x: 0, y: 0 });
      t.drawImage(img, cover.left, cover.top, cover.width, cover.height);
      ctx.drawImage(tiny, 0, 0, STORY_W, STORY_H);
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.fillRect(0, 0, STORY_W, STORY_H);
    }
  }
  const k = STORY_W / frame.w;
  const p = placement(size, frame, fit, v);
  ctx.drawImage(img, p.left * k, p.top * k, p.width * k, p.height * k);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Rendu impossible'))), 'image/jpeg', 0.88));
}
