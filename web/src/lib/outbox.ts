import type { Me, Message } from '@mandrix/shared';
import { create } from 'zustand';
import { api, ApiError } from './api';
import { qc } from './data';

// Messages écrits sans réseau : gardés (et sauvegardés sur l'appareil) puis envoyés au retour du réseau.

export interface Pending {
  tempId: string;
  /** Compte qui a écrit le message (la file n'envoie que ceux du compte connecté). */
  userId: string;
  conversationId: string;
  text: string;
  replyToId?: string;
  createdAt: string;
  status: 'pending' | 'failed';
  error?: string;
}

const KEY = 'mandrix.outbox';
const load = (): Pending[] => {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as Pending[]).filter((p) => p.userId).map((p) => ({ ...p, status: p.status ?? 'pending' }));
  } catch {
    return [];
  }
};

export const useOutbox = create<{ items: Pending[] }>(() => ({ items: load() }));

useOutbox.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s.items));
  } catch {
    /* stockage indisponible */
  }
});

const update = (tempId: string, patch: Partial<Pending> | null) =>
  useOutbox.setState((s) => ({
    items: patch === null ? s.items.filter((p) => p.tempId !== tempId) : s.items.map((p) => (p.tempId === tempId ? { ...p, ...patch } : p)),
  }));

export const newClientId = () => `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export function queueMessage(userId: string, conversationId: string, text: string, replyToId?: string, tempId = newClientId()) {
  const item: Pending = { tempId, userId, conversationId, text, replyToId, createdAt: new Date().toISOString(), status: 'pending' };
  useOutbox.setState((s) => ({ items: [...s.items, item] }));
  return item;
}

export const discardPending = (tempId: string) => update(tempId, null);

let flushing = false;
/** Envoie les messages en attente, dans l'ordre. Une erreur réseau arrête le tour (on réessaiera). */
export async function flushOutbox(onlyId?: string) {
  if (!navigator.onLine) return;
  if (flushing) {
    again = true;
    return;
  }
  const me = qc.getQueryData<Me | null>(['me']);
  if (!me) return;
  flushing = true;
  try {
    for (const { tempId } of [...useOutbox.getState().items]) {
      // État relu à chaque tour : un « Réessayer » pendant l'envoi est pris en compte.
      const p = useOutbox.getState().items.find((x) => x.tempId === tempId);
      if (!p || p.userId !== me.id || p.status !== 'pending' || (onlyId && p.tempId !== onlyId)) continue;
      try {
        // Même identifiant d'envoi à chaque tentative : le serveur ne crée jamais de doublon.
        const m = await api<Message>(`/api/conversations/${p.conversationId}/messages`, { body: { text: p.text, replyToId: p.replyToId, clientId: p.tempId } });
        update(p.tempId, null);
        qc.setQueryData<Message[]>(['messages', p.conversationId], (old) => (old && !old.some((x) => x.id === m.id) ? [...old, m] : old));
        qc.invalidateQueries({ queryKey: ['conversations'] });
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) break; // toujours hors ligne
        update(p.tempId, { status: 'failed', error: (e as Error).message });
      }
    }
  } finally {
    flushing = false;
  }
  if (again) {
    again = false;
    void flushOutbox();
  }
}
let again = false;

export const retryPending = (tempId: string) => {
  update(tempId, { status: 'pending', error: undefined });
  void flushOutbox(tempId);
};

window.addEventListener('online', () => void flushOutbox());
