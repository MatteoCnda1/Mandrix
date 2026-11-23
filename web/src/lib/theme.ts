import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();

function read(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

/** Thème choisi : clair, sombre, ou automatique (suit le réglage du téléphone). */
export type ThemePref = 'light' | 'dark' | 'auto';
const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

export function getThemePref(): ThemePref {
  try {
    const d = localStorage.getItem('mandrix.dark');
    return d === '1' ? 'dark' : d === '0' ? 'light' : 'auto';
  } catch {
    return 'auto';
  }
}

function apply(dark: boolean) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#071120' : '#E8F2FC');
  listeners.forEach((l) => l());
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === 'auto') localStorage.removeItem('mandrix.dark');
    else localStorage.setItem('mandrix.dark', pref === 'dark' ? '1' : '0');
  } catch {
    /* stockage indisponible */
  }
  apply(pref === 'auto' ? systemDark() : pref === 'dark');
}

export function setDark(dark: boolean) {
  setThemePref(dark ? 'dark' : 'light');
}

// En automatique, on suit le téléphone en direct (passage au mode sombre le soir…).
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (getThemePref() === 'auto') apply(e.matches);
});

export function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  // Le choix lui-même (et pas seulement le thème affiché) : Sombre ↔ Automatique le soir ne change pas data-theme.
  const pref = useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, getThemePref);
  return [pref, setThemePref];
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

// ——— Ambiance de fond (mémorisée par appareil) ———

export type Ambiance = 'aurore' | 'ciel' | 'doodles' | 'heure';
export const AMBIANCES: { id: Ambiance; label: string; text: string }[] = [
  { id: 'aurore', label: 'Aurore', text: 'Des couleurs qui ondulent doucement' },
  { id: 'ciel', label: 'Ciel vivant', text: 'Nuages le jour, étoiles en mode sombre' },
  { id: 'doodles', label: 'Doodles & grain', text: 'Mandrills, bulles et stickers' },
  { id: 'heure', label: 'Heure réelle', text: 'Le ciel suit l’heure, doré le dimanche à 20 h' },
];

const ambianceListeners = new Set<() => void>();
const readAmbiance = (): Ambiance => (document.documentElement.dataset.ambiance as Ambiance) || 'aurore';

export function setAmbiance(a: Ambiance) {
  document.documentElement.dataset.ambiance = a;
  try {
    localStorage.setItem('mandrix.ambiance', a);
  } catch {
    /* stockage indisponible */
  }
  ambianceListeners.forEach((l) => l());
}

export function useAmbiance(): [Ambiance, (a: Ambiance) => void] {
  const a = useSyncExternalStore((cb) => {
    ambianceListeners.add(cb);
    return () => ambianceListeners.delete(cb);
  }, readAmbiance);
  return [a, setAmbiance];
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
