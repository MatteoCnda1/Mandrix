import { useRef, useState } from 'react';

/**
 * Glisser vers le bas pour fermer (visionneuses plein écran). Les gestes horizontaux sont ignorés
 * (barre de lecture d'une vidéo, défilement). À poser sur un élément en `touch-action: none`.
 */
export function useSwipeDown(onDismiss: () => void, threshold = 110) {
  const [dy, setDy] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cur = useRef(0);
  const end = () => {
    if (start.current && cur.current > threshold) onDismiss();
    start.current = null;
    cur.current = 0;
    setDy(0);
  };
  return {
    dy,
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType === 'mouse') return;
        start.current = { x: e.clientX, y: e.clientY };
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (!start.current) return;
        const x = e.clientX - start.current.x;
        const y = e.clientY - start.current.y;
        if (Math.abs(x) > 12 && Math.abs(x) > Math.abs(y)) {
          start.current = null;
          cur.current = 0;
          return setDy(0);
        }
        cur.current = Math.max(0, y);
        setDy(cur.current);
      },
      onPointerUp: end,
      onPointerCancel: end,
    },
  };
}

/**
 * Glisser horizontalement un élément (ex. une bulle pour y répondre). Le défilement vertical reste
 * natif (`touch-action: pan-y`) ; au-delà de `threshold` px, `onSwipe` est appelé au relâcher.
 */
export function useSwipeX(onSwipe: (dir: 1 | -1) => void, { threshold = 64, max = 90 } = {}) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const locked = useRef<'x' | 'y' | null>(null);
  const cur = useRef(0);
  const end = () => {
    if (locked.current === 'x' && Math.abs(cur.current) >= threshold) onSwipe(cur.current > 0 ? 1 : -1);
    start.current = null;
    locked.current = null;
    cur.current = 0;
    setDx(0);
  };
  return {
    dx,
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        // Les 24 premiers pixels sont réservés au retour par le bord gauche (iPhone).
        if (e.pointerType === 'mouse' || e.clientX <= 24) return;
        start.current = { x: e.clientX, y: e.clientY };
        locked.current = null;
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (!start.current) return;
        const x = e.clientX - start.current.x;
        const y = e.clientY - start.current.y;
        if (!locked.current && (Math.abs(x) > 8 || Math.abs(y) > 8)) locked.current = Math.abs(x) > Math.abs(y) ? 'x' : 'y';
        if (locked.current !== 'x') return;
        const damped = Math.sign(x) * Math.min(max, Math.abs(x) * 0.6);
        cur.current = damped;
        if (Math.abs(damped) >= threshold && Math.abs(dx) < threshold) navigator.vibrate?.(8);
        setDx(damped);
      },
      onPointerUp: end,
      onPointerCancel: end,
    },
  };
}

export interface MediaGestureHandlers {
  /** Tap court : zone gauche (35 %) ou droite. */
  onTap?: (zone: 'left' | 'right') => void;
  /** Maintenir le doigt (pause), puis relâcher. */
  onHold?: (holding: boolean) => void;
  onSwipeDown?: () => void;
  /** Glisser horizontal : -1 vers la gauche (suivant), 1 vers la droite (précédent). */
  onSwipeX?: (dir: 1 | -1) => void;
}

/**
 * Gestes des visionneuses plein écran (stories, rétrospective, photos du déballage) :
 * tap gauche/droite, maintenir pour mettre en pause, glisser vers le bas pour fermer,
 * glisser sur le côté pour changer. Un appui maintenu ne déclenche jamais de tap au relâcher.
 * À poser sur un calque en `touch-action: none`.
 */
export function useMediaGestures(h: MediaGestureHandlers) {
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const cb = useRef(h);
  cb.current = h;
  const g = useRef<{ x: number; y: number; held: boolean; hold: ReturnType<typeof setTimeout> | undefined } | null>(null);
  const end = (e: React.PointerEvent<HTMLElement>, cancelled = false) => {
    const s = g.current;
    g.current = null;
    setDrag(null);
    if (!s) return;
    clearTimeout(s.hold);
    if (s.held) cb.current.onHold?.(false);
    if (cancelled) return;
    const x = e.clientX - s.x;
    const y = e.clientY - s.y;
    if (y > 90 && y > Math.abs(x) && cb.current.onSwipeDown) return cb.current.onSwipeDown();
    if (Math.abs(x) > 70 && Math.abs(x) > Math.abs(y) && cb.current.onSwipeX) return cb.current.onSwipeX(x < 0 ? -1 : 1);
    if (!s.held && Math.abs(x) < 10 && Math.abs(y) < 10) {
      const r = e.currentTarget.getBoundingClientRect();
      cb.current.onTap?.(e.clientX - r.left < r.width * 0.35 ? 'left' : 'right');
    }
  };
  return {
    drag,
    /** Transformation à appliquer au cadre pendant le glisser. */
    style: (drag
      ? {
          transform:
            drag.y > 0 && drag.y > Math.abs(drag.x)
              ? `translateY(${drag.y}px) scale(${1 - Math.min(drag.y, 400) / 2000})`
              : `translateX(${drag.x * 0.4}px)`,
          transition: 'none',
        }
      : { transition: 'transform .25s cubic-bezier(.2,.9,.2,1)' }) as React.CSSProperties,
    handlers: {
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* pointeur déjà relâché */
        }
        const s = { x: e.clientX, y: e.clientY, held: false, hold: undefined as ReturnType<typeof setTimeout> | undefined };
        if (cb.current.onHold)
          s.hold = setTimeout(() => {
            s.held = true;
            cb.current.onHold?.(true);
          }, 220);
        g.current = s;
      },
      onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
        const s = g.current;
        if (!s) return;
        const x = e.clientX - s.x;
        const y = e.clientY - s.y;
        if (Math.abs(x) > 8 || Math.abs(y) > 8) clearTimeout(s.hold);
        setDrag({ x, y });
      },
      onPointerUp: (e: React.PointerEvent<HTMLElement>) => end(e),
      onPointerCancel: (e: React.PointerEvent<HTMLElement>) => end(e, true),
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    },
  };
}

/**
 * Tap simple ou double tap sur le même élément. Le tap simple attend un court instant
 * pour savoir si un second tap suit (comme sur Instagram : double tap = j'aime).
 */
export function useDoubleTap(onSingle: (() => void) | null, onDouble: (p: { x: number; y: number }) => void, delay = 260) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  return (e: React.MouseEvent) => {
    const p = { x: e.clientX, y: e.clientY };
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = undefined;
      return onDouble(p);
    }
    timer.current = setTimeout(() => {
      timer.current = undefined;
      onSingle?.();
    }, delay);
  };
}
