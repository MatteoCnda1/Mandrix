import type { Message } from '@mandrix/shared';
import { create } from 'zustand';
import { api, ApiError } from './api';
import { qc } from './data';

// Messages écrits sans réseau : gardés (et sauvegardés sur l'appareil) puis envoyés au retour du réseau.

export interface Pending {
  tempId: string;
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
    return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as Pending[]).map((p) => ({ ...p, status: p.status ?? 'pending' }));
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

export function queueMessage(conversationId: string, text: string, replyToId?: string) {
  const item: Pending = { tempId: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, conversationId, text, replyToId, createdAt: new Date().toISOString(), status: 'pending' };
  useOutbox.setState((s) => ({ items: [...s.items, item] }));
  return item;
}

export const discardPending = (tempId: string) => update(tempId, null);

let flushing = false;
/** Envoie les messages en attente, dans l'ordre. Une erreur réseau arrête le tour (on réessaiera). */
export async function flushOutbox(onlyId?: string) {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    for (const p of [...useOutbox.getState().items]) {
      if (onlyId ? p.tempId !== onlyId : p.status !== 'pending') continue;
      try {
        const m = await api<Message>(`/api/conversations/${p.conversationId}/messages`, { body: { text: p.text, replyToId: p.replyToId } });
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
}

export const retryPending = (tempId: string) => {
  update(tempId, { status: 'pending', error: undefined });
  void flushOutbox(tempId);
};

window.addEventListener('online', () => void flushOutbox());
