import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router';
import { isIOS, isStandalone } from './push';

// Retour arrière fiable. Un bouton « retour » qui fait `navigate('/messages')` empile une nouvelle
// page : depuis la liste, le retour du navigateur renvoie alors dans la conversation, et ainsi de suite.
// On suit donc l'historique de la session pour revenir en arrière quand la page visée est la précédente,
// et sinon remplacer la page courante (lien ouvert depuis une notification, rechargement…).

const stack: string[] = [];

/** À monter une seule fois, au-dessus des écrans. */
export function useHistoryTracker() {
  const loc = useLocation();
  const type = useNavigationType();
  useEffect(() => {
    const path = loc.pathname;
    if (type === 'PUSH') stack.push(path);
    else if (type === 'REPLACE') {
      if (stack.length) stack[stack.length - 1] = path;
      else stack.push(path);
    } else {
      // Retour ou avance du navigateur (ou premier chargement).
      const i = stack.lastIndexOf(path);
      if (i >= 0) stack.length = i + 1;
      else stack.push(path);
    }
  }, [loc.key]); // eslint-disable-line react-hooks/exhaustive-deps
}

export const previousPath = () => (stack.length > 1 ? stack[stack.length - 2] : null);

/**
 * Revenir à `target` (chemin) ou à la page précédente (-1).
 * Jamais d'empilement : soit on recule dans l'historique, soit on remplace la page courante.
 */
export function useGoBack() {
  const nav = useNavigate();
  return (target: string | -1, fallback = '/') => {
    const prev = previousPath();
    if (target === -1) {
      if (prev) nav(-1);
      else nav(fallback, { replace: true });
    } else if (prev === target) nav(-1);
    else nav(target, { replace: true });
  };
}

/**
 * Glisser depuis le bord gauche pour revenir (comme sur iPhone). Seulement dans la PWA installée
 * sur iOS : ailleurs, le navigateur ou Android ont déjà leur propre geste de retour.
 * Renvoie la distance glissée (pour l'indicateur), 0 au repos.
 */
export function useEdgeSwipeBack(onBack: (() => void) | null) {
  const [dx, setDx] = useState(0);
  const cb = useRef(onBack);
  cb.current = onBack;
  useEffect(() => {
    if (!onBack || !isIOS() || !isStandalone()) return;
    let start: { x: number; y: number } | null = null;
    let horizontal = false;
    let cur = 0;
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      if (e.touches.length !== 1 || t.clientX > 24) return;
      start = { x: t.clientX, y: t.clientY };
      horizontal = false;
    };
    const move = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      const x = t.clientX - start.x;
      const y = t.clientY - start.y;
      if (!horizontal) {
        if (Math.abs(y) > 12 && Math.abs(y) > Math.abs(x)) return void (start = null);
        if (x > 10) horizontal = true;
      }
      if (horizontal) {
        e.preventDefault();
        cur = Math.max(0, x);
        setDx(cur);
      }
    };
    const up = () => {
      if (start && horizontal && cur > 90) cb.current?.();
      start = null;
      cur = 0;
      setDx(0);
    };
    document.addEventListener('touchstart', down, { passive: true });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', up);
    document.addEventListener('touchcancel', up);
    return () => {
      document.removeEventListener('touchstart', down);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
      document.removeEventListener('touchcancel', up);
    };
  }, [!!onBack]); // eslint-disable-line react-hooks/exhaustive-deps
  return dx;
}
