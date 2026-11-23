import { env } from '../env.js';

// Le fuseau horaire est celui du processus (TZ=Europe/Paris par défaut) :
// les méthodes locales de Date suffisent pour caler le déballage du dimanche 20h.

/** Prochain déballage strictement après `from`. */
export function nextReveal(from = new Date()): Date {
  const t = new Date(from);
  t.setHours(env.revealHour, 0, 0, 0);
  let add = (env.revealDay - from.getDay() + 7) % 7;
  if (add === 0 && from >= t) add = 7;
  t.setDate(t.getDate() + add);
  return t;
}

/** Dernier déballage passé (≤ `from`). */
export function prevReveal(from = new Date()): Date {
  const n = nextReveal(from);
  const p = new Date(n);
  p.setDate(p.getDate() - 7);
  return p;
}

export function weekLabel(revealAt: Date): string {
  const end = new Date(revealAt);
  const start = new Date(revealAt);
  start.setDate(start.getDate() - 6);
  const endTxt = end.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const startTxt =
    start.getMonth() === end.getMonth()
      ? String(start.getDate())
      : start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  return `Semaine du ${startTxt} au ${endTxt}`;
}

/** Index 0 = lundi … 6 = dimanche. */
export const mondayIndex = (d: Date) => (d.getDay() + 6) % 7;
