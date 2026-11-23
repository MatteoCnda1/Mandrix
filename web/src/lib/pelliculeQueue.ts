// File d'attente des photos de la Pellicule prises sans réseau.
// Utilisée par la page (au retour du réseau / à l'ouverture) et par le service worker
// (Background Sync sur Android) : pas de dépendance au DOM ici.
import type { PelliculeState } from '@mandrix/shared';
import { createStore, del, entries, set } from 'idb-keyval';

export interface PendingShot {
  id: string;
  blob: Blob;
  takenAt: string;
}

let dbStore: ReturnType<typeof createStore> | null = null;
const store = () => (dbStore ??= createStore('mandrix', 'pellicule-queue'));
export const SYNC_TAG = 'pellicule-upload';

type Listener = (count: number) => void;
const listeners = new Set<Listener>();
export const onQueueChange = (l: Listener) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
async function emit() {
  const n = await pendingCount();
  listeners.forEach((l) => l(n));
}

export async function pendingCount() {
  try {
    return (await entries(store())).length;
  } catch {
    return 0;
  }
}

export class NetworkError extends Error {}

/** Envoie une photo ; lève NetworkError si le serveur est injoignable. */
export async function uploadShot(shot: PendingShot): Promise<PelliculeState | null> {
  const fd = new FormData();
  // Les champs texte doivent précéder le fichier pour être lus par le serveur.
  fd.append('clientId', shot.id);
  fd.append('takenAt', shot.takenAt);
  fd.append('file', shot.blob, 'pellicule.jpg');
  let res: Response;
  try {
    res = await fetch('/api/pellicule/shots', { method: 'POST', body: fd, credentials: 'same-origin' });
  } catch {
    throw new NetworkError('Pas de connexion au serveur');
  }
  if (res.status >= 500 || res.status === 0) throw new NetworkError('Serveur indisponible');
  if (!res.ok) return null; // Refus définitif (format, session…) : inutile de réessayer.
  return (await res.json()) as PelliculeState;
}

export async function enqueueShot(shot: PendingShot) {
  await set(shot.id, shot, store());
  await emit();
  // Android : le service worker renverra la photo même si l'app est fermée.
  try {
    const reg = (await navigator.serviceWorker?.ready) as (ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }) | undefined;
    await reg?.sync?.register(SYNC_TAG);
  } catch {
    /* Background Sync indisponible (iOS) : envoi à la prochaine ouverture */
  }
}

let flushing: Promise<{ sent: number; last: PelliculeState | null }> | null = null;

/** Envoie toutes les photos en attente, dans l'ordre de prise de vue. */
export function flushQueue() {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    let last: PelliculeState | null = null;
    try {
      const items = (await entries(store())).map(([, v]) => v as PendingShot).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
      for (const shot of items) {
        try {
          const state = await uploadShot(shot);
          if (state) {
            last = state;
            sent++;
          }
          await del(shot.id, store());
        } catch (e) {
          if (e instanceof NetworkError) break;
          throw e;
        }
      }
    } finally {
      flushing = null;
      await emit().catch(() => {});
    }
    return { sent, last };
  })();
  return flushing;
}
