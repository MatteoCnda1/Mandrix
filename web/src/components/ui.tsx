import type { MediaRef, UserLite } from '@mandrix/shared';
import { X } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';
import { useUI } from '../lib/store';

/** Fusionne les classes Tailwind (la dernière gagne en cas de conflit). */
const cx = (...c: (string | false | null | undefined)[]) => twMerge(c.filter(Boolean).join(' '));
export { cx };

/** Mascotte Mandrix (singe pensif) reproduite à partir des formes de la maquette. */
export function Logo({ size = 42, className }: { size?: number; className?: string }) {
  const abs = 'absolute';
  return (
    <div className={cx('relative flex-none', className)} style={{ width: '1em', height: '1em', fontSize: size }} aria-hidden>
      <div className={cx(abs, 'rounded-full bg-brand2')} style={{ left: '-.07em', top: '.3em', width: '.3em', height: '.3em' }} />
      <div className={cx(abs, 'rounded-full bg-brand2')} style={{ right: '-.07em', top: '.3em', width: '.3em', height: '.3em' }} />
      <div className={cx(abs, 'rounded-full bg-ink')} style={{ inset: '.04em' }} />
      <div className={cx(abs, 'bg-card')} style={{ left: '.23em', top: '.37em', width: '.54em', height: '.48em', borderRadius: '.24em .24em .27em .27em' }} />
      <div className={cx(abs, 'rounded-full bg-ink')} style={{ left: '.36em', top: '.47em', width: '.08em', height: '.08em' }} />
      <div className={cx(abs, 'rounded-full bg-ink')} style={{ left: '.56em', top: '.47em', width: '.08em', height: '.08em' }} />
      <div className={cx(abs, 'bg-ink')} style={{ left: '.44em', top: '.66em', width: '.12em', height: '.03em', borderRadius: '.02em' }} />
      <div className={cx(abs, 'bg-brand2')} style={{ left: '.5em', top: '.76em', width: '.36em', height: '.17em', borderRadius: '.09em', transform: 'rotate(-30deg)' }} />
      <div className={cx(abs, 'rounded-full bg-ink')} style={{ right: '-.06em', top: '.02em', width: '.13em', height: '.13em' }} />
      <div className={cx(abs, 'rounded-full bg-ink')} style={{ right: '-.2em', top: '-.14em', width: '.09em', height: '.09em' }} />
    </div>
  );
}

const TONES = ['bg-tint text-ink', 'bg-ink text-inv', 'bg-azure text-white'];

export function Avatar({ user, size = 44, ring, className }: { user: Pick<UserLite, 'initials' | 'tone' | 'avatarUrl' | 'displayName'>; size?: number; ring?: boolean; className?: string }) {
  const style: CSSProperties = { width: size, height: size, fontSize: Math.round(size * 0.34) };
  if (ring) style.boxShadow = '0 0 0 4px var(--card), 0 0 0 7px #2A9DF4';
  return user.avatarUrl ? (
    <img src={user.avatarUrl} alt="" loading="lazy" className={cx('flex-none rounded-full object-cover bg-soft', className)} style={style} />
  ) : (
    <div className={cx('grid flex-none place-items-center rounded-full font-bold', TONES[user.tone] ?? TONES[0], className)} style={style}>
      {user.initials}
    </div>
  );
}

export function Seg<T extends string | number>({ options, value, onChange, className, size = 'md' }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string; size?: 'md' | 'sm' }) {
  return (
    <div className={cx('flex gap-1 rounded-[26px] bg-soft p-1', className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'tap flex-1 border-0 font-bold transition-colors duration-300',
            size === 'md' ? 'h-11 rounded-[22px] px-4 text-sm' : 'h-10 rounded-[20px] px-3 text-[13px]',
            o.value === value ? 'bg-ink text-inv' : 'bg-transparent text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on }: { on: boolean }) {
  return (
    <span className={cx('relative h-[30px] w-[52px] flex-none rounded-[15px] transition-colors duration-300', on ? 'bg-brand' : 'bg-line')}>
      <span
        className="absolute top-[3px] left-[3px] h-6 w-6 rounded-full bg-white transition-transform duration-[350ms] ease-spring"
        style={{ transform: on ? 'translateX(22px)' : 'none' }}
      />
    </span>
  );
}

/** Feuille du bas (HIG) : poignée, fermeture par glissement vers le bas, Échap ou tap sur le fond. */
export function Sheet({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const [dragY, setDragY] = useState(0);
  const [closing, setClosing] = useState(false);
  const drag = useRef<{ y: number; t: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const dismiss = () => {
    setClosing(true);
    setTimeout(onClose, 220);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { y: e.clientY, t: Date.now() };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (drag.current) setDragY(Math.max(0, e.clientY - drag.current.y));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dy = e.clientY - drag.current.y;
    const speed = dy / Math.max(1, Date.now() - drag.current.t);
    drag.current = null;
    if (dy > 110 || (dy > 30 && speed > 0.6)) dismiss();
    else setDragY(0);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" role="dialog" aria-modal="true">
      <div
        onClick={dismiss}
        className="absolute inset-0 animate-fade bg-[rgba(8,12,17,.5)] transition-opacity duration-200"
        style={{ opacity: closing ? 0 : Math.max(0.3, 1 - dragY / 500) }}
      />
      <div
        className={cx(
          'relative flex max-h-[86vh] w-full flex-col gap-3 overflow-auto rounded-t-[32px] bg-card px-4 pt-2.5 text-ink shadow-[0_-10px_40px_rgba(11,15,20,.2)]',
          wide ? 'max-w-[640px]' : 'max-w-[560px]',
        )}
        style={{
          // « backwards » : l'animation d'entrée ne bloque pas la transformation du glisser.
          animation: 'mxSheet .45s cubic-bezier(.2,.9,.2,1) backwards',
          paddingBottom: 'calc(18px + env(safe-area-inset-bottom))',
          transform: closing ? 'translateY(100%)' : dragY ? `translateY(${dragY}px)` : undefined,
          transition: drag.current ? 'none' : 'transform .22s cubic-bezier(.2,.9,.2,1)',
        }}
      >
        <div
          className="-mx-4 -mt-2.5 flex cursor-grab touch-none flex-col gap-3 px-4 pt-2.5 active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="h-[5px] w-11 flex-none self-center rounded-[3px] bg-line" />
          <div className="flex items-center gap-2.5">
            <div className="mr-auto text-xl font-extrabold tracking-[-.02em]">{title}</div>
            <IconBtn label="Fermer" onClick={dismiss}>
              <X size={20} />
            </IconBtn>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

// ——— Feuille d'actions de confirmation (remplace window.confirm, HIG) ———

interface ConfirmReq {
  title: string;
  message?: string;
  confirmLabel: string;
  destructive?: boolean;
  resolve: (ok: boolean) => void;
}

let confirmSetter: ((r: ConfirmReq | null) => void) | null = null;

export function confirmAction(opts: Omit<ConfirmReq, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    if (!confirmSetter) return resolve(window.confirm(opts.title));
    confirmSetter({ ...opts, resolve });
  });
}

export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmReq | null>(null);
  useEffect(() => {
    confirmSetter = setReq;
    return () => {
      confirmSetter = null;
    };
  }, []);
  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && answer(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (!req) return null;
  const answer = (ok: boolean) => {
    req.resolve(ok);
    setReq(null);
  };
  const row = 'tap flex h-14 w-full items-center justify-center border-0 bg-transparent text-[17px] transition-colors active:bg-soft';
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-2.5" role="alertdialog" aria-modal="true" aria-label={req.title} style={{ paddingBottom: 'calc(10px + env(safe-area-inset-bottom))' }}>
      <div onClick={() => answer(false)} className="absolute inset-0 animate-fade bg-[rgba(8,12,17,.45)]" />
      <div className="relative flex w-full max-w-[420px] animate-sheet flex-col gap-2">
        <div className="overflow-hidden rounded-[24px] bg-card text-center">
          <div className="flex flex-col gap-1 px-5 pt-4 pb-3.5">
            <div className="text-[13px] font-bold text-mute">{req.title}</div>
            {req.message && <div className="text-[13px] leading-snug text-mute">{req.message}</div>}
          </div>
          <button type="button" autoFocus onClick={() => answer(true)} className={cx(row, 'border-t border-line font-semibold', req.destructive ? 'text-heart' : 'text-acc')}>
            {req.confirmLabel}
          </button>
        </div>
        <button type="button" onClick={() => answer(false)} className={cx(row, 'rounded-[24px] bg-card font-bold text-acc')}>
          Annuler
        </button>
      </div>
    </div>
  );
}

export function IconBtn({ label, onClick, children, className, dark, size = 44 }: { label: string; onClick?: () => void; children: ReactNode; className?: string; dark?: boolean; size?: number }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cx(
        'tap grid flex-none place-items-center rounded-full border-0 transition-transform duration-200 active:scale-90',
        dark ? 'bg-ink text-inv' : 'bg-soft text-ink',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {children}
    </button>
  );
}

export function Toast() {
  const t = useUI((s) => s.toast);
  const [last, setLast] = useState(t);
  useEffect(() => {
    if (t) setLast(t);
  }, [t]);
  const shown = last;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 z-50 flex h-12 max-w-[calc(100vw-32px)] items-center gap-2 rounded-3xl bg-hero px-[18px] text-sm font-bold whitespace-nowrap text-white shadow-hero transition-[transform,opacity] duration-[400ms] ease-spring"
      style={{
        bottom: 'calc(var(--toast-bottom, 28px) + env(safe-area-inset-bottom))',
        transform: `translate(-50%, ${t ? '0px' : '20px'})`,
        opacity: t ? 1 : 0,
      }}
    >
      <span className={cx('h-2.5 w-2.5 flex-none rounded-full', shown?.tone === 'error' ? 'bg-heartlite' : 'bg-ice')} />
      <span className="overflow-hidden text-ellipsis">{shown?.msg}</span>
    </div>
  );
}

export function MediaView({ media, className, style, controls, autoPlay, muted = true, loop = true, onClick, fit = 'cover', videoRef }: {
  media: MediaRef;
  className?: string;
  style?: CSSProperties;
  controls?: boolean;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  onClick?: () => void;
  fit?: 'cover' | 'contain';
  videoRef?: React.Ref<HTMLVideoElement>;
}) {
  const fitCls = fit === 'cover' ? 'object-cover' : 'object-contain';
  if (media.kind === 'video') {
    return (
      <video
        ref={videoRef}
        src={media.url}
        className={cx('h-full w-full', fitCls, className)}
        style={style}
        controls={controls}
        autoPlay={autoPlay}
        muted={muted}
        loop={loop}
        playsInline
        preload="metadata"
        onClick={onClick}
      />
    );
  }
  return <img src={media.url} alt="" loading="lazy" decoding="async" className={cx('h-full w-full', fitCls, className)} style={style} onClick={onClick} />;
}

/** Ratio d'affichage d'un média, borné pour rester lisible dans le fil. */
export function ratioOf(m: MediaRef | null, fallback = '4 / 5') {
  if (!m?.width || !m.height) return fallback;
  const r = Math.min(1.91, Math.max(0.8, m.width / m.height));
  return String(r);
}

export function ScreenLoader() {
  const block = 'skel';
  return (
    <div aria-busy="true" aria-label="Chargement" className="relative flex flex-col gap-3.5">
      <div className="pointer-events-none absolute top-[150px] right-0 left-0 z-[1] animate-breath text-center font-script text-[clamp(60px,13vw,96px)] leading-none text-ink">
        Mandrix
      </div>
      {['16 / 10', '16 / 7'].map((ar) => (
        <div key={ar} className="card flex flex-col gap-3 p-3.5">
          <div className="flex items-center gap-2.5">
            <div className={cx(block, 'h-11 w-11 rounded-full')} />
            <div className="flex flex-col gap-[7px]">
              <div className={cx(block, 'h-3 w-[130px] rounded-md')} />
              <div className={cx(block, 'h-2.5 w-[84px] rounded-[5px]')} />
            </div>
          </div>
          <div className={cx(block, 'rounded-3xl')} style={{ aspectRatio: ar }} />
          <div className="flex gap-2">
            <div className={cx(block, 'h-11 w-[76px] rounded-[22px]')} />
            <div className={cx(block, 'h-11 w-[76px] rounded-[22px]')} />
            <div className={cx(block, 'ml-auto h-11 w-24 rounded-[22px]')} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyCard({ icon, title, text, children }: { icon: ReactNode; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="card flex animate-in flex-col items-center gap-3 px-6 py-8 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-full bg-tint text-ink">{icon}</div>
      <div className="text-xl font-extrabold tracking-[-.02em]">{title}</div>
      <p className="m-0 max-w-[360px] text-[15px] leading-normal text-pretty text-mute">{text}</p>
      {children}
    </div>
  );
}

export function PrimaryBtn({ children, onClick, disabled, className, type = 'button', tone = 'ink' }: { children: ReactNode; onClick?: () => void; disabled?: boolean; className?: string; type?: 'button' | 'submit'; tone?: 'ink' | 'brand' | 'soft' | 'danger' }) {
  const tones = { ink: 'bg-ink text-inv', brand: 'bg-brand text-white shadow-blue', soft: 'bg-soft text-ink', danger: 'bg-heart text-white' };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'tap flex h-[52px] items-center justify-center gap-2 rounded-[26px] border-0 px-5 text-[15px] font-bold transition-[transform,background,color] duration-200 active:scale-[.97]',
        disabled ? 'cursor-not-allowed bg-line text-mute shadow-none' : tones[tone],
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Podium à trois marches (2 · 1 · 3), comme dans la maquette. */
export function Podium({ entries, heights = ['124px', '96px', '70px'], height = 220 }: {
  entries: { key: string; top: ReactNode; label: ReactNode; sub?: ReactNode }[];
  heights?: [string, string, string] | string[];
  height?: number;
}) {
  const styles = [
    { bg: 'bg-brand text-white', size: 'text-3xl' },
    { bg: 'bg-ink text-inv', size: 'text-2xl' },
    { bg: 'bg-tint text-ink', size: 'text-[22px]' },
  ];
  const order = [1, 0, 2].filter((i) => i < entries.length);
  return (
    <div className="grid grid-cols-3 items-end gap-2.5" style={{ height }}>
      {[1, 0, 2].map((rank) => {
        const e = entries[rank];
        if (!e) return <div key={rank} />;
        return (
          <div key={e.key} className="flex h-full min-w-0 flex-col items-center justify-end gap-1.5">
            {e.top}
            <div className="max-w-full overflow-hidden text-center text-[13px] leading-tight font-bold text-ellipsis">{e.label}</div>
            {e.sub}
            <div
              className={cx('grid w-full flex-none origin-bottom animate-grow place-items-center rounded-[20px_20px_8px_8px] font-extrabold', styles[rank].bg, styles[rank].size)}
              style={{ height: heights[rank], animationDelay: `${order.indexOf(rank) * 0.15}s` }}
            >
              {rank + 1}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Champ fichier caché déclenché par un bouton. */
export function useFilePicker(accept: string, onPick: (f: File) => void, capture?: 'user' | 'environment') {
  const ref = useRef<HTMLInputElement | null>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept={accept}
      capture={capture}
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onPick(f);
        e.target.value = '';
      }}
    />
  );
  return { input, open: () => ref.current?.click() };
}
