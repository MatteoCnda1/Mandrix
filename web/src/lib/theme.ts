import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();

function read(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

export function setDark(dark: boolean) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0E2A47' : '#86C5F4');
  try {
    localStorage.setItem('mandrix.dark', dark ? '1' : '0');
  } catch {
    /* stockage indisponible */
  }
  listeners.forEach((l) => l());
}

export function useDark(): [boolean, () => void] {
  const dark = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
  );
  return [dark, () => setDark(!dark)];
}

// ——— Largeur d'écran (téléphone < 720 px, bureau ≥ 1120 px, comme la maquette) ———

const subscribeResize = (cb: () => void) => {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
};

export function useViewport() {
  const w = useSyncExternalStore(subscribeResize, () => window.innerWidth);
  return { w, isPhone: w < 720, isDesktop: w >= 1120 };
}
