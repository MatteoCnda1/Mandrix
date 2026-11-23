import { confirmAction } from '../components/ui';
import { isStandalone } from './push';

/**
 * Télécharge un fichier sans quitter l'app. Dans la PWA installée sur iPhone, un lien de
 * téléchargement ouvre le fichier à la place de l'app (sans retour possible) : on passe alors
 * par la feuille de partage (« Enregistrer dans Fichiers »). Ailleurs, téléchargement classique.
 */
export async function downloadFile(url: string, fallbackName: string, onProgress?: (msg: string) => void) {
  onProgress?.('Préparation du fichier…');
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? 'Téléchargement impossible');
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const blob = await res.blob();
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  if (isStandalone() && navigator.canShare?.({ files: [file] })) {
    // iOS exige un geste récent pour ouvrir la feuille de partage : le téléchargement l'a fait expirer,
    // on demande donc un tap de confirmation, et la feuille s'ouvre dans ce tap.
    const ok = await confirmAction({ title: 'Fichier prêt', message: `${name} · ${(blob.size / 1048576).toFixed(1).replace('.', ',')} Mo`, confirmLabel: 'Enregistrer' });
    if (!ok) return;
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
  }
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
