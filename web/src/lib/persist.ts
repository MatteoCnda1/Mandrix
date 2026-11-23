import type { Me } from '@mandrix/shared';
import { dehydrate, hydrate, type DehydratedState } from '@tanstack/react-query';
import { createStore, del, get, set } from 'idb-keyval';
import { qc } from './data';

/** Identifiant de la version compilée : une nouvelle version repart d'un cache vide (formats changés). */
declare const __BUILD_ID__: string;

// Ouverture instantanée (#79) : les dernières données (fil, conversations, profil…) sont gardées sur
// l'appareil et affichées dès l'ouverture, pendant que l'app recharge les données à jour.

const KEY = 'state';
const MAX_AGE = 3 * 24 * 3600_000;
const KEEP = new Set(['me', 'config', 'feed', 'stories', 'conversations', 'conversation', 'messages', 'badges', 'notifications', 'profile', 'user-posts', 'pellicule', 'friends', 'memes', 'daily']);

interface Saved {
  build: string;
  at: number;
  userId: string;
  state: DehydratedState;
}

let store: ReturnType<typeof createStore> | null = null;
// Base à part : la file de la Pellicule a la sienne (« mandrix »).
const db = () => (store ??= createStore('mandrix-cache', 'queries'));

/** Remet en mémoire les données gardées (si elles viennent de cette version et datent de moins de 3 jours). */
export async function restoreCache() {
  try {
    const saved = await get<Saved>(KEY, db());
    if (!saved || saved.build !== __BUILD_ID__ || Date.now() - saved.at > MAX_AGE) return;
    hydrate(qc, saved.state);
  } catch {
    /* IndexedDB indisponible (navigation privée…) : ouverture normale */
  }
}

type Q = DehydratedState['queries'][number];

/** Allège ce qui est gardé : première page du fil, 60 derniers messages par conversation. */
function trim(q: Q): Q {
  const key = String(q.queryKey[0]);
  const data = q.state.data as unknown;
  if (key === 'messages' && Array.isArray(data)) return { ...q, state: { ...q.state, data: data.slice(-60) } };
  if (key === 'feed' && data && typeof data === 'object' && 'pages' in data) {
    const d = data as { pages: unknown[]; pageParams: unknown[] };
    return { ...q, state: { ...q.state, data: { pages: d.pages.slice(0, 1), pageParams: d.pageParams.slice(0, 1) } } };
  }
  return q;
}

async function save() {
  try {
    const me = qc.getQueryData<Me | null>(['me']);
    // Déconnecté : rien ne reste sur l'appareil.
    if (!me) return void (await del(KEY, db()));
    const state = dehydrate(qc, { shouldDehydrateQuery: (q) => q.state.status === 'success' && KEEP.has(String(q.queryKey[0])) });
    await set(KEY, { build: __BUILD_ID__, at: Date.now(), userId: me.id, state: { ...state, queries: state.queries.map(trim) } } satisfies Saved, db());
  } catch {
    /* stockage plein ou indisponible */
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Sauvegarde au fil des changements (regroupés), et quand l'app passe en arrière-plan. */
export function startPersisting() {
  qc.getQueryCache().subscribe((e) => {
    if (e.type !== 'updated' && e.type !== 'removed') return;
    clearTimeout(timer);
    timer = setTimeout(() => void save(), 1500);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      clearTimeout(timer);
      void save();
    }
  });
}

/** Déconnexion : on efface tout de suite le cache gardé. */
export async function forgetCache() {
  clearTimeout(timer);
  try {
    await del(KEY, db());
  } catch {
    /* rien à effacer */
  }
}
