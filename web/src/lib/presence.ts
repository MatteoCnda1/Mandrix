import type { Presence } from '@mandrix/shared';
import { create } from 'zustand';
import { timeAgo } from './format';

/** Présence des amis (conversations à deux), mise à jour en direct par le socket. */
export const usePresence = create<Record<string, Presence | null>>(() => ({}));

/** Heure de la dernière présence reçue en direct, par ami. */
const liveAt = new Map<string, number>();

export const setPresence = (userId: string, p: Presence | null) => {
  liveAt.set(userId, Date.now());
  usePresence.setState({ [userId]: p });
};

/** Présence reçue avec la liste des conversations : elle fait foi (le socket a pu être coupé). */
export function seedPresence(entries: [string, Presence | null][], fetchedAt = Date.now()) {
  // Liste en cache (retour sur l'écran) : elle ne remplace pas ce que le socket a appris depuis.
  const fresh = entries.filter(([id]) => (liveAt.get(id) ?? 0) <= fetchedAt);
  if (fresh.length) usePresence.setState(Object.fromEntries(fresh));
}

/** Reconnexion, présence masquée : on oublie tout et on repart des données du serveur. */
export const resetPresence = () => {
  liveAt.clear();
  usePresence.setState(() => ({}), true);
};

export function presenceLabel(p: Presence | null | undefined, now = Date.now()) {
  if (!p) return null;
  if (p.online) return 'En ligne';
  if (!p.lastSeenAt) return null;
  const ago = timeAgo(p.lastSeenAt, now);
  return ago === 'à l’instant' ? 'Actif à l’instant' : `Actif ${ago}`;
}
