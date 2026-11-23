import type { ReactionCount } from '@mandrix/shared';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Point } from '../lib/hooks';
import { cx, Portal } from './ui';

export interface MenuAction {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onClick: () => void;
}

/**
 * Barre de réactions flottante (appui long) avec actions facultatives en dessous
 * (« Signaler », « Copier »…). Se place près du doigt sans sortir de l'écran.
 */
export function ReactionPicker({
  at,
  emojis,
  current,
  onPick,
  onClose,
  actions = [],
}: {
  at: Point;
  emojis: readonly string[];
  current: string | null;
  onPick?: (emoji: string) => void;
  onClose: () => void;
  actions?: MenuAction[];
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const left = Math.min(Math.max(12, at.x - width / 2), vw - width - 12);
    // Au-dessus du doigt si possible, sinon en dessous.
    const above = at.y - height - 18;
    const top = above > 12 ? above : Math.min(at.y + 18, vh - height - 12);
    setPos({ left, top });
  }, [at.x, at.y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Portal>
      <div className="fixed inset-0 z-[70]" onClick={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())} role="presentation">
        <div
          ref={ref}
          role="menu"
          aria-label="Réagir"
          onClick={(e) => e.stopPropagation()}
          className="fixed flex animate-pop flex-col gap-1.5"
          style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
        >
          {onPick && (
            <div className="glass-bar flex gap-0.5 rounded-full p-1.5 shadow-pill">
              {emojis.map((e) => (
                <button
                  key={e}
                  type="button"
                  role="menuitemradio"
                  aria-checked={current === e}
                  aria-label={`Réagir ${e}`}
                  onClick={() => {
                    onPick(e);
                    onClose();
                  }}
                  className={cx(
                    'tap grid h-11 w-11 place-items-center rounded-full border-0 bg-transparent text-[1.625rem] leading-none transition-transform hover:scale-125 active:scale-90',
                    current === e && 'bg-tint',
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
          {actions.length > 0 && (
            <div className="glass-bar flex flex-col overflow-hidden rounded-[18px] p-1 shadow-pill">
              {actions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onClose();
                    a.onClick();
                  }}
                  className={cx(
                    'tap flex h-11 items-center gap-2.5 rounded-[14px] border-0 bg-transparent px-3 text-left text-[0.9375rem] font-semibold hover:bg-soft',
                    a.danger ? 'text-heart' : 'text-ink',
                  )}
                >
                  {a.icon}
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}

/** Résumé compact : les trois réactions les plus fréquentes et le total. */
export function ReactionSummary({ reactions, onClick, className }: { reactions: ReactionCount[]; onClick?: () => void; className?: string }) {
  const total = reactions.reduce((n, r) => n + r.count, 0);
  if (total === 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${total} réaction${total > 1 ? 's' : ''} : ${reactions.map((r) => `${r.emoji} ${r.count}`).join(', ')}`}
      className={cx('tap flex h-8 items-center gap-1 rounded-full border-0 bg-soft px-2.5 text-[0.8125rem] font-bold text-ink', className)}
    >
      <span className="flex -space-x-0.5 text-[0.9375rem] leading-none">
        {reactions.slice(0, 3).map((r) => (
          <span key={r.emoji}>{r.emoji}</span>
        ))}
      </span>
      <span className="tabular-nums">{total}</span>
    </button>
  );
}
