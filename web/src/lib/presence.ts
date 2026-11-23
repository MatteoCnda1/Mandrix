import type { Presence } from '@mandrix/shared';
import { create } from 'zustand';
import { timeAgo } from './format';

/** Présence des amis (conversations à deux), mise à jour en direct par le socket. */
export const usePresence = create<Record<string, Presence | null>>(() => ({}));

export const setPresence = (userId: string, p: Presence | null) => usePresence.setState({ [userId]: p });

/** Présence reçue avec la liste des conversations : elle fait foi (le socket a pu être coupé). */
export function seedPresence(entries: [string, Presence | null][]) {
  if (entries.length) usePresence.setState(Object.fromEntries(entries));
}

/** Reconnexion, présence masquée : on oublie tout et on repart des données du serveur. */
export const resetPresence = () => usePresence.setState(() => ({}), true);

export function presenceLabel(p: Presence | null | undefined, now = Date.now()) {
  if (!p) return null;
  if (p.online) return 'En ligne';
  if (!p.lastSeenAt) return null;
  const ago = timeAgo(p.lastSeenAt, now);
  return ago === 'à l’instant' ? 'Actif à l’instant' : `Actif ${ago}`;
}
