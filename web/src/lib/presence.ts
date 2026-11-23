import type { Presence } from '@mandrix/shared';
import { create } from 'zustand';
import { timeAgo } from './format';

/** Présence des amis (conversations à deux), mise à jour en direct par le socket. */
export const usePresence = create<Record<string, Presence | null>>(() => ({}));

export const setPresence = (userId: string, p: Presence | null) => usePresence.setState({ [userId]: p });

/** Enregistre la présence reçue avec une conversation, sans écraser une info plus récente du socket. */
export function seedPresence(entries: [string, Presence | null][]) {
  const cur = usePresence.getState();
  const next: Record<string, Presence | null> = {};
  for (const [id, p] of entries) if (!(id in cur)) next[id] = p;
  if (Object.keys(next).length) usePresence.setState(next);
}

export function presenceLabel(p: Presence | null | undefined, now = Date.now()) {
  if (!p) return null;
  if (p.online) return 'En ligne';
  if (!p.lastSeenAt) return null;
  const ago = timeAgo(p.lastSeenAt, now);
  return ago === 'à l’instant' ? 'Actif à l’instant' : `Actif ${ago}`;
}
