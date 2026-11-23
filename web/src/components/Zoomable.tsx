import type { MediaRef } from '@mandrix/shared';
import { useRef, useState } from 'react';
import { cx } from './ui';

interface Props {
  media: MediaRef;
  /** Glisser vers le bas (photo non zoomée) : fermer. */
  onDismiss?: () => void;
  /** Glisser sur le côté (photo non zoomée) : -1 suivante, 1 précédente. */
  onSwipeX?: (dir: 1 | -1) => void;
  className?: string;
}

type P = { x: number; y: number };
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: P, b: P) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const MAX = 4;

/**
 * Photo plein écran zoomable : pincer pour zoomer (jusqu'à ×4), double tap pour zoomer / revenir,
 * glisser pour se déplacer une fois zoomé. Non zoomée : glisser vers le bas ferme, sur le côté change.
 * Le zoom de la page est bloqué dans l'app (preventPinchZoom) : ce zoom-ci est fait à la main.
 */
export function ZoomableImage({ media, onDismiss, onSwipeX, className }: Props) {
  const box = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [drag, setDrag] = useState<P | null>(null);
  const [live, setLive] = useState(false);
  const pointers = useRef(new Map<number, P>());
  const g = useRef<{ start: P; view: typeof view; pinch?: { d: number; m: P }; moved: boolean } | null>(null);
  const lastTap = useRef<{ t: number; p: P } | null>(null);

  const clamp = (v: typeof view) => {
    const r = box.current?.getBoundingClientRect();
    const scale = Math.min(MAX, Math.max(1, v.scale));
    if (!r || scale === 1) return { scale, x: 0, y: 0 };
    const mx = (r.width * (scale - 1)) / 2;
    const my = (r.height * (scale - 1)) / 2;
    return { scale, x: Math.max(-mx, Math.min(mx, v.x)), y: Math.max(-my, Math.min(my, v.y)) };
  };

  const zoomAt = (p: P, scale: number) => {
    const r = box.current!.getBoundingClientRect();
    const cx0 = p.x - (r.left + r.width / 2);
    const cy0 = p.y - (r.top + r.height / 2);
    setView(clamp({ scale, x: -cx0 * (scale - 1), y: -cy0 * (scale - 1) }));
  };

  const down = (e: React.PointerEvent) => {
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointeur déjà relâché */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setLive(true);
    const pts = [...pointers.current.values()];
    if (pts.length === 2) g.current = { start: mid(pts[0], pts[1]), view, pinch: { d: dist(pts[0], pts[1]), m: mid(pts[0], pts[1]) }, moved: true };
    else if (pts.length === 1) g.current = { start: pts[0], view, moved: false };
  };

  const move = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!pointers.current.has(e.pointerId) || !g.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const s = g.current;
    if (s.pinch && pts.length >= 2) {
      const m = mid(pts[0], pts[1]);
      const scale = (s.view.scale * dist(pts[0], pts[1])) / s.pinch.d;
      setView(clamp({ scale, x: s.view.x + (m.x - s.pinch.m.x), y: s.view.y + (m.y - s.pinch.m.y) }));
      return;
    }
    const dx = e.clientX - s.start.x;
    const dy = e.clientY - s.start.y;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) s.moved = true;
    if (s.view.scale > 1) setView(clamp({ scale: s.view.scale, x: s.view.x + dx, y: s.view.y + dy }));
    else setDrag({ x: dx, y: dy });
  };

  const up = (e: React.PointerEvent) => {
    e.stopPropagation();
    pointers.current.delete(e.pointerId);
    const s = g.current;
    if (pointers.current.size > 0) {
      // Un doigt reste : on repart d'un déplacement simple depuis sa position.
      const [p] = [...pointers.current.values()];
      g.current = { start: p, view, moved: true };
      return;
    }
    g.current = null;
    setLive(false);
    setDrag(null);
    if (!s) return;
    if (view.scale < 1.05) setView({ scale: 1, x: 0, y: 0 });
    if (s.pinch || s.view.scale > 1) {
      if (!s.moved) tap(e);
      return;
    }
    const dx = e.clientX - s.start.x;
    const dy = e.clientY - s.start.y;
    if (dy > 110 && dy > Math.abs(dx)) return onDismiss?.();
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) return onSwipeX?.(dx < 0 ? -1 : 1);
    if (!s.moved) tap(e);
  };

  /** Double tap : zoom ×2,5 à l'endroit touché, ou retour à la taille normale. */
  const tap = (e: React.PointerEvent) => {
    const p = { x: e.clientX, y: e.clientY };
    const last = lastTap.current;
    if (last && Date.now() - last.t < 300 && dist(last.p, p) < 40) {
      lastTap.current = null;
      if (view.scale > 1) setView({ scale: 1, x: 0, y: 0 });
      else zoomAt(p, 2.5);
    } else lastTap.current = { t: Date.now(), p };
  };

  const dragging = drag && view.scale === 1;
  const transform = dragging
    ? drag.y > 0 && drag.y > Math.abs(drag.x)
      ? `translateY(${drag.y}px) scale(${1 - Math.min(drag.y, 400) / 1600})`
      : `translateX(${drag.x * 0.4}px)`
    : `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;

  return (
    <div
      ref={box}
      className={cx('relative h-full w-full touch-none overflow-hidden select-none', className)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
      role="img"
      aria-label="Photo (pincer ou toucher deux fois pour zoomer)"
    >
      <img
        src={media.url}
        alt=""
        draggable={false}
        className="h-full w-full object-contain"
        style={{ transform, transition: live ? 'none' : 'transform .25s cubic-bezier(.2,.9,.2,1)', willChange: 'transform' }}
      />
    </div>
  );
}
