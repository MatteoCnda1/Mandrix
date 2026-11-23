import { useEffect } from 'react';

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
  useEffect(() => {
    if (!active) return;
    const html = document.documentElement;
    const prev = [html.style.overflow, document.body.style.overflow];
    html.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prev[0];
      document.body.style.overflow = prev[1];
    };
  }, [active]);
}
