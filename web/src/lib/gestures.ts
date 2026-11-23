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
        if (e.pointerType === 'mouse') return;
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
