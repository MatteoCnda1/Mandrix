import { Heart } from '@phosphor-icons/react';
import { useState } from 'react';

/** Grand cœur qui apparaît au double tap, puis s'efface. */
export function useHeartBurst() {
  const [burst, setBurst] = useState<{ id: number; x: number; y: number } | null>(null);
  const show = (el: HTMLElement | null, p: { x: number; y: number }) => {
    const r = el?.getBoundingClientRect();
    setBurst({ id: Date.now(), x: r ? p.x - r.left : 0, y: r ? p.y - r.top : 0 });
    navigator.vibrate?.(10);
  };
  const node = burst && (
    <span
      key={burst.id}
      aria-hidden
      className="pointer-events-none absolute z-10 animate-burst text-white drop-shadow-[0_6px_18px_rgba(229,72,77,.55)]"
      style={{ left: burst.x - 48, top: burst.y - 48 }}
      onAnimationEnd={() => setBurst(null)}
    >
      <Heart size={96} weight="fill" className="text-heartlite" />
    </span>
  );
  return { show, node };
}
