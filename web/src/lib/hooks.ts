import { useEffect, useRef, useState } from 'react';

/** Horloge qui se met à jour toutes les `ms` millisecondes. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Déclenche `onHit` quand l'élément sentinelle devient visible (scroll infini). */
export function useSentinel(onHit: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const cb = useRef(onHit);
  cb.current = onHit;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && cb.current(), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);
  return ref;
}

/** URL d'aperçu locale pour un fichier choisi (libérée automatiquement). */
export function useObjectUrl(file: Blob | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setUrl(null);
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}

/** Tirer vers le bas en haut de page pour actualiser (écrans tactiles). */
export function usePullToRefresh(onRefresh: () => Promise<unknown>) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const cb = useRef(onRefresh);
  cb.current = onRefresh;
  const busy = useRef(false);

  useEffect(() => {
    let startY = 0;
    let active = false;
    let dist = 0;
    const onStart = (e: TouchEvent) => {
      if (busy.current || window.scrollY > 0 || document.body.style.overflow === 'hidden') return;
      startY = e.touches[0].clientY;
      dist = 0;
      active = true;
    };
    const onMove = (e: TouchEvent) => {
      if (!active) return;
      dist = e.touches[0].clientY - startY;
      if (dist > 0 && window.scrollY <= 0) setPull(Math.min(120, dist * 0.45));
      else {
        active = false;
        setPull(0);
      }
    };
    const onEnd = async () => {
      if (!active) return;
      active = false;
      if (dist * 0.45 < 72) return setPull(0);
      busy.current = true;
      setRefreshing(true);
      setPull(56);
      try {
        await cb.current();
      } finally {
        busy.current = false;
        setRefreshing(false);
        setPull(0);
      }
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  return { pull, refreshing };
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Appui long (téléphone) ou clic droit (ordinateur). Le clic qui suit un appui long est annulé,
 * pour que le tap « normal » (j'aime, ouvrir) ne se déclenche pas en plus.
 */
export function useLongPress(onLong: (p: Point) => void, ms = 420) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef<Point | null>(null);
  const fired = useRef(false);
  const cb = useRef(onLong);
  cb.current = onLong;
  const clear = () => {
    clearTimeout(timer.current);
    start.current = null;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      fired.current = false;
      const p = { x: e.clientX, y: e.clientY };
      start.current = p;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        fired.current = true;
        navigator.vibrate?.(12);
        cb.current(p);
      }, ms);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      clear();
      fired.current = true;
      cb.current({ x: e.clientX, y: e.clientY });
    },
    onClickCapture: (e: React.MouseEvent) => {
      if (fired.current) {
        e.preventDefault();
        e.stopPropagation();
        fired.current = false;
      }
    },
  };
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
