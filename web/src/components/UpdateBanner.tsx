import { ArrowClockwise, Sparkle, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { useUI } from '../lib/store';

/** Bandeau flottant affiché quand une nouvelle version de Mandrix est prête. */
export function UpdateBanner() {
  const ready = useUI((s) => s.updateReady);
  const apply = useUI((s) => s.applyUpdate);
  const [busy, setBusy] = useState(false);
  if (!ready) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-3" style={{ top: 'calc(76px + env(safe-area-inset-top))' }}>
      <div
        role="alert"
        className="pointer-events-auto flex max-w-full animate-drop items-center gap-2 rounded-[28px] bg-hero py-1.5 pr-1.5 pl-3.5 text-white shadow-hero"
      >
        <Sparkle size={16} weight="fill" className="flex-none text-ice" />
        <span className="min-w-0 truncate text-[0.8125rem] font-bold sm:text-sm">
          Nouvelle version<span className="hidden sm:inline"> disponible</span>
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            apply?.();
          }}
          className="tap flex h-10 flex-none items-center gap-1.5 rounded-[20px] border-0 bg-brand px-3.5 text-[0.8125rem] font-bold text-white transition-transform active:scale-95 sm:px-4 sm:text-sm"
        >
          <ArrowClockwise size={16} weight="bold" className={busy ? 'animate-spin' : undefined} />
          {busy ? 'Mise à jour…' : 'Mettre à jour'}
        </button>
        <button
          type="button"
          aria-label="Plus tard"
          onClick={() => useUI.setState({ updateReady: false })}
          className="tap grid h-10 w-10 flex-none place-items-center rounded-full border-0 bg-white/15 text-white"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
