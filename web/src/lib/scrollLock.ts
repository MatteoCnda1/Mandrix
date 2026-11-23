import { useEffect } from 'react';

// Blocage du défilement de la page, compté : une feuille ouverte par-dessus une conversation
// (elle-même en plein écran) ne laisse plus la page bloquée quand les deux se ferment ensemble.

let count = 0;

export function lockScroll() {
  if (count++ === 0) {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--count === 0) {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
  };
}

export const isScrollLocked = () => count > 0;

export function useScrollLock(active = true) {
  useEffect(() => (active ? lockScroll() : undefined), [active]);
}
