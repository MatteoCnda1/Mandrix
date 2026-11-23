import { useEffect } from 'react';
import { useScrollLock } from './scrollLock';

// Clavier virtuel (iPhone surtout) : Safari réduit la « zone visible » et fait défiler la page
// pour garder le champ actif à l'écran, ce qui fait remonter tout l'écran. On publie la taille
// et la position réelles de la zone visible en variables CSS pour caler les écrans de saisie
// (conversation, feuilles, réponse aux stories) juste au-dessus du clavier :
//   --vvh    hauteur visible        --vv-top  décalage du haut de la zone visible
//   --kb     hauteur du clavier     .kb-open  classe sur <html> quand le clavier est ouvert

export function useKeyboardViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let baseline = vv.height;
    let frame = 0;

    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        baseline = Math.max(baseline, vv.height);
        const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        const open = baseline - vv.height > 150 || kb > 150;
        root.style.setProperty('--vvh', `${vv.height}px`);
        root.style.setProperty('--vv-top', `${vv.offsetTop}px`);
        root.style.setProperty('--kb', `${kb}px`);
        root.classList.toggle('kb-open', open);
      });
    };
    const resetBaseline = () => {
      baseline = vv.height;
      update();
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    window.addEventListener('orientationchange', resetBaseline);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      window.removeEventListener('orientationchange', resetBaseline);
    };
  }, []);
}

/** Bloque le défilement de la page (l'écran gère son propre défilement interne). */
export function useLockPageScroll(active = true) {
  useScrollLock(active);
}

/**
 * Bloque le zoom au pincement : Safari iOS ignore « user-scalable=no » depuis iOS 10,
 * il faut annuler ses évènements de geste. Les autres navigateurs reçoivent deux doigts
 * en touchmove ; sur ordinateur, le pincement du trackpad arrive en molette + Ctrl.
 */
export function preventPinchZoom() {
  const stop = (e: Event) => e.preventDefault();
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, stop, { passive: false });
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
  window.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { passive: false },
  );
}
