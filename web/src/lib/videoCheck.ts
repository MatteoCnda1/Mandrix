import { videoTooLong, VIDEO_LIMITS } from '@mandrix/shared';
import { toast } from './store';

/** Durée d'une vidéo choisie sur l'appareil (lue dans ses métadonnées), ou null si illisible ici. */
export function videoDuration(file: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    const done = (d: number | null) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
      resolve(d);
    };
    const timer = setTimeout(() => done(null), 6000);
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => done(null);
    v.src = url;
  });
}

/**
 * Refuse tout de suite une vidéo trop longue, avec la raison (le serveur vérifie aussi).
 * Renvoie true si la vidéo peut être envoyée.
 */
export async function checkVideoLength(file: Blob, where: keyof typeof VIDEO_LIMITS): Promise<boolean> {
  if (!file.type.startsWith('video/')) return true;
  const reason = videoTooLong(await videoDuration(file), where);
  if (reason) toast(reason, 'error');
  return !reason;
}
