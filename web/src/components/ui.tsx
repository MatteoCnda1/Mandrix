import type { MediaRef, UserLite } from '@mandrix/shared';
import { ArrowClockwise, CircleNotch, Detective, WifiSlash, X } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { lockScroll } from '../lib/scrollLock';
import { twMerge } from 'tailwind-merge';
import logoSymbol from '../assets/logo/mandrix-symbol.svg';
import { useUI } from '../lib/store';

/** Fusionne les classes Tailwind (la dernière gagne en cas de conflit). */
const cx = (...c: (string | false | null | undefined)[]) => twMerge(c.filter(Boolean).join(' '));
export { cx };

/**
 * Logo Mandrix : le mandrill pensif low poly sur sa tuile ciel (docs/logo).
 * La tuile porte son propre fond, donc le logo reste lisible en mode clair comme en mode sombre.
 */
export function Logo({ size = 42, className }: { size?: number; className?: string }) {
  return (
    <img
      src={logoSymbol}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      // 22 % = rayon de la tuile (56/256) : l'ombre suit les coins arrondis du SVG
      className={cx('flex-none select-none rounded-[22%] shadow-pill', className)}
    />
  );
}

// Bleu « brand » plutôt qu'« azure » : initiales blanches lisibles (4,7:1 au lieu de 3,5:1).
const TONES = ['bg-tint text-ink', 'bg-ink text-inv', 'bg-brand text-white'];

export function Avatar({ user, size = 44, ring, className, anonymous }: { user: Pick<UserLite, 'initials' | 'tone' | 'avatarUrl' | 'displayName' | 'birthdayToday'>; size?: number; ring?: boolean; className?: string; anonymous?: boolean }) {
  const style: CSSProperties = { width: size, height: size, fontSize: Math.round(size * 0.34) };
  if (ring) style.boxShadow = '0 0 0 4px var(--card), 0 0 0 7px #2A9DF4';
  // Contenu anonyme : un détective à la place de la photo.
  if (anonymous) {
    return (
      <div aria-hidden="true" className={cx('grid flex-none place-items-center rounded-full bg-ink text-inv', className)} style={style}>
        <Detective size={Math.round(size * 0.56)} weight="fill" />
      </div>
    );
  }
  // 🎂 le jour de son anniversaire (à partir d'une taille lisible).
  if (user.birthdayToday && size >= 36) {
    return (
      <span className={cx('relative inline-grid flex-none', className)} style={{ width: size, height: size }}>
        <Avatar user={{ ...user, birthdayToday: false }} size={size} ring={ring} />
        <span aria-label="Anniversaire aujourd’hui" className="absolute -right-1 -bottom-1 leading-none" style={{ fontSize: Math.round(size * 0.42) }}>
          🎂
        </span>
      </span>
    );
  }
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
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'tap flex-1 border-0 font-bold transition-colors duration-300',
            // 44 px de haut dans les deux tailles (HIG) ; la petite taille resserre le texte et les marges.
            size === 'md' ? 'h-11 rounded-[22px] px-4 text-sm' : 'h-11 rounded-[22px] px-2 text-[0.8125rem] leading-tight',
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
    <span className={cx('relative inline-block h-[30px] w-[52px] flex-none rounded-[15px] align-middle transition-colors duration-300', on ? 'bg-brand' : 'bg-line')}>
      <span
        className="absolute top-[3px] left-[3px] h-6 w-6 rounded-full bg-white transition-transform duration-[350ms] ease-spring"
        style={{ transform: on ? 'translateX(22px)' : 'none' }}
      />
    </span>
  );
}

/** Feuilles ouvertes, de la plus ancienne à celle du dessus : seule la dernière répond au clavier. */
const sheetStack: number[] = [];
let sheetSeq = 0;
/** Une confirmation ou un menu est ouvert par-dessus : c'est lui qui gère Échap et Tab. */
const overlayAbove = () => !!document.querySelector('[role="alertdialog"], [role="menu"]');

/** Feuille du bas (HIG) : poignée, fermeture par glissement vers le bas, Échap ou tap sur le fond. */
export function Sheet({
  title,
  onClose,
  children,
  wide,
  locked,
  onLockedClose,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** Fermeture impossible (envoi en cours…) : `onLockedClose` explique pourquoi. */
  locked?: boolean;
  onLockedClose?: () => void;
}) {
  const [dragY, setDragY] = useState(0);
  const [closing, setClosing] = useState(false);
  const drag = useRef<{ y: number; t: number } | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const sheetId = useRef(0);
  const isTop = () => sheetStack[sheetStack.length - 1] === sheetId.current && !overlayAbove();

  // Lecteur d'écran et clavier : le focus entre dans la feuille, y reste, et revient d'où il venait.
  useEffect(() => {
    sheetId.current = ++sheetSeq;
    sheetStack.push(sheetId.current);
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus({ preventScroll: true });
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !panel.current || !isTop()) return;
      const items = panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', trap);
    return () => {
      window.removeEventListener('keydown', trap);
      sheetStack.splice(sheetStack.indexOf(sheetId.current), 1);
      prev?.focus?.({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Échap ferme la feuille du dessus seulement (pas celle d'en dessous, ni sous une confirmation).
      if (e.key !== 'Escape' || !isTop()) return;
      if (lockedRef.current) onLockedClose?.();
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    const release = lockScroll();
    return () => {
      window.removeEventListener('keydown', onKey);
      release();
    };
  }, [onClose]);

  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  // Glisser vers le bas depuis le contenu (pas seulement la poignée), quand il est défilé tout en haut.
  const dismissRef = useRef<() => void>(() => {});
  const [touching, setTouching] = useState(false);
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    let start: { y: number; x: number } | null = null;
    let active = false;
    let dy = 0;
    const down = (e: TouchEvent) => {
      const t = e.target as HTMLElement;
      if (el.scrollTop > 0 || e.touches.length !== 1 || t.closest('input, textarea, select, [data-no-sheet-drag]')) return (start = null);
      start = { y: e.touches[0].clientY, x: e.touches[0].clientX };
      active = false;
      dy = 0;
    };
    const move = (e: TouchEvent) => {
      if (!start) return;
      const y = e.touches[0].clientY - start.y;
      const x = e.touches[0].clientX - start.x;
      if (!active) {
        if (y > 8 && y > Math.abs(x) && el.scrollTop <= 0) {
          active = true;
          setTouching(true);
        }
        else if (Math.abs(y) > 8 || Math.abs(x) > 8) return void (start = null);
        else return;
      }
      e.preventDefault();
      dy = Math.max(0, y);
      setDragY(dy);
    };
    const up = () => {
      if (active) {
        if (dy > 120) dismissRef.current();
        else setDragY(0);
      }
      start = null;
      active = false;
      setTouching(false);
    };
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', up);
    el.addEventListener('touchcancel', up);
    return () => {
      el.removeEventListener('touchstart', down);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', up);
      el.removeEventListener('touchcancel', up);
    };
  }, []);
  const dismiss = () => {
    if (lockedRef.current) {
      setDragY(0);
      return onLockedClose?.();
    }
    setClosing(true);
    setTimeout(onClose, 220);
  };
  dismissRef.current = dismiss;
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

  return createPortal(
    <div
      className="fixed inset-x-0 z-[62] flex items-end justify-center"
      style={{ top: 'var(--vv-top, 0px)', height: 'var(--vvh, 100dvh)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        onClick={dismiss}
        className="absolute inset-0 animate-fade bg-[rgba(8,12,17,.5)] transition-opacity duration-200"
        style={{ opacity: closing ? 0 : Math.max(0.3, 1 - dragY / 500) }}
      />
      <div
        ref={panel}
        tabIndex={-1}
        className={cx(
          // `*:shrink-0` : quand le contenu dépasse, la feuille défile au lieu d'écraser champs et boutons.
          'no-scrollbar relative flex max-h-[calc(var(--vvh,100dvh)*0.9)] outline-none w-full flex-col gap-3 overflow-auto overscroll-contain rounded-t-[32px] bg-card px-4 pt-2.5 text-ink shadow-[0_-10px_40px_rgba(11,15,20,.2)] *:shrink-0',
          wide ? 'max-w-[640px]' : 'max-w-[560px]',
        )}
        style={{
          // « backwards » : l'animation d'entrée ne bloque pas la transformation du glisser.
          animation: 'mxSheet .45s cubic-bezier(.2,.9,.2,1) backwards',
          paddingBottom: 'calc(18px + var(--safe-b))',
          transform: closing ? 'translateY(100%)' : dragY ? `translateY(${dragY}px)` : undefined,
          transition: drag.current || touching ? 'none' : 'transform .22s cubic-bezier(.2,.9,.2,1)',
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
            <h2 id={titleId} className="m-0 mr-auto text-xl font-extrabold tracking-[-.02em]">
              {title}
            </h2>
            <IconBtn label="Fermer" onClick={dismiss}>
              <X size={20} />
            </IconBtn>
          </div>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Bas de feuille collant (bouton principal, champ de saisie) : il reste visible quand une longue liste défile.
 * Les marges annulent le bas de la feuille (`18px + --safe-b`) pour garder l'indicateur d'accueil dégagé.
 */
export function SheetFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    // Le collant se cale sur le bas du contenu (marge intérieure exclue) : `bottom` négatif pour toucher le bord de la feuille.
    <div className={cx('sticky -bottom-[calc(18px+var(--safe-b))] z-[1] -mx-4 -mb-[calc(18px+var(--safe-b))] flex flex-col gap-2 bg-card px-4 pt-2 pb-[calc(18px+var(--safe-b))]', className)}>
      {children}
    </div>
  );
}

/** Affiche un calque plein écran à la racine du document : il reste au-dessus de tout
 * (barre d'onglets comprise), même si l'écran parent est animé. */
export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

// ——— Feuille d'actions de confirmation (remplace window.confirm, HIG) ———

interface ActionChoice {
  label: string;
  value: string;
  destructive?: boolean;
}

interface ConfirmReq {
  title: string;
  message?: string;
  /** Du choix conseillé (en premier, avec le focus) au moins conseillé. */
  actions: ActionChoice[];
  cancelLabel: string;
  resolve: (value: string | null) => void;
}

let confirmSetter: ((r: ConfirmReq | null) => void) | null = null;

/**
 * Feuille d'actions à plusieurs choix : la valeur du bouton touché, ou null pour le bouton
 * d'annulation (Échap, toucher le fond).
 */
export function chooseAction(opts: { title: string; message?: string; actions: ActionChoice[]; cancelLabel?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    if (!confirmSetter) return resolve(window.confirm(opts.title) ? (opts.actions[0]?.value ?? null) : null);
    confirmSetter({ ...opts, cancelLabel: opts.cancelLabel ?? 'Annuler', resolve });
  });
}

export function confirmAction(opts: { title: string; message?: string; confirmLabel: string; destructive?: boolean }): Promise<boolean> {
  return chooseAction({ title: opts.title, message: opts.message, actions: [{ label: opts.confirmLabel, value: 'ok', destructive: opts.destructive }] }).then(
    (v) => v === 'ok',
  );
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
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && answer(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (!req) return null;
  const answer = (value: string | null) => {
    req.resolve(value);
    setReq(null);
  };
  const row = 'tap flex min-h-14 w-full items-center justify-center border-0 bg-transparent px-4 text-[1.0625rem] transition-colors active:bg-soft';
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-2.5" role="alertdialog" aria-modal="true" aria-label={req.title} style={{ paddingBottom: 'calc(10px + env(safe-area-inset-bottom))' }}>
      <div onClick={() => answer(null)} className="absolute inset-0 animate-fade bg-[rgba(8,12,17,.45)]" />
      <div className="relative flex w-full max-w-[420px] animate-sheet flex-col gap-2">
        <div className="overflow-hidden rounded-[24px] bg-card text-center">
          <div className="flex flex-col gap-1 px-5 pt-4 pb-3.5">
            <div className="text-[0.8125rem] font-bold text-mute">{req.title}</div>
            {req.message && <div className="text-[0.8125rem] leading-snug text-mute">{req.message}</div>}
          </div>
          {req.actions.map((a, i) => (
            <button
              key={a.value}
              type="button"
              autoFocus={i === 0}
              onClick={() => answer(a.value)}
              className={cx(row, 'border-t border-line', i === 0 ? 'font-semibold' : 'font-normal', a.destructive ? 'text-heart' : 'text-acc')}
            >
              {a.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => answer(null)} className={cx(row, 'rounded-[24px] bg-card font-bold text-acc')}>
          {req.cancelLabel}
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
      className="pointer-events-none fixed left-1/2 z-[85] flex min-h-12 w-max max-w-[min(440px,calc(100vw-32px))] items-center gap-2 rounded-3xl bg-hero px-[18px] py-3 text-sm font-bold text-white shadow-hero transition-[transform,opacity] duration-[400ms] ease-spring"
      style={{
        bottom: 'calc(var(--toast-bottom, 28px) + env(safe-area-inset-bottom))',
        transform: `translate(-50%, ${t ? '0px' : '20px'})`,
        opacity: t ? 1 : 0,
      }}
    >
      <span className={cx('h-2.5 w-2.5 flex-none rounded-full', shown?.tone === 'error' ? 'bg-heartlite' : 'bg-ice')} />
      {/* Message long (erreur du serveur…) : sur trois lignes au plus, plutôt que coupé au bout d'une. */}
      <span className="line-clamp-3 leading-snug">{shown?.msg}</span>
    </div>
  );
}

export function MediaView({ media, className, style, controls, autoPlay, muted = true, loop = true, onClick, fit = 'cover', videoRef, sizes = '(max-width: 700px) 100vw, 640px' }: {
  media: MediaRef;
  /** Largeur d'affichage, pour choisir la bonne variante de la photo (`srcset`). */
  sizes?: string;
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
  if (media.kind === 'video' && media.processing) return <VideoProcessing className={className} style={style} />;
  if (media.kind === 'video') {
    return (
      <video
        ref={videoRef}
        src={media.url}
        poster={media.poster ?? undefined}
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
  return (
    <img
      src={media.url}
      srcSet={media.srcSet ?? undefined}
      sizes={media.srcSet ? sizes : undefined}
      alt=""
      loading="lazy"
      decoding="async"
      className={cx('h-full w-full', fitCls, className)}
      style={style}
      onClick={onClick}
    />
  );
}

/** Indicateur « tirer pour rafraîchir » (voir usePullToRefresh). */
export function PullIndicator({ pull, refreshing }: { pull: number; refreshing: boolean }) {
  return (
    <div
      className="-mb-3.5 flex items-end justify-center overflow-hidden"
      style={{ height: pull, transition: pull && !refreshing ? 'none' : 'height .3s cubic-bezier(.2,.9,.2,1)' }}
      aria-hidden={!refreshing}
    >
      <span className="mb-2 grid h-10 w-10 place-items-center rounded-full bg-card text-acc shadow-pill">
        <ArrowClockwise
          size={20}
          weight="bold"
          className={refreshing ? 'animate-spin' : undefined}
          style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)`, opacity: Math.min(1, pull / 60) }}
        />
      </span>
    </div>
  );
}

/** Vidéo en cours de transcodage sur le serveur. */
export function VideoProcessing({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div className={cx('phdark flex h-full w-full flex-col items-center justify-center gap-2 text-center text-[0.8125rem] font-bold text-white/85', className)} style={style}>
      <CircleNotch size={28} className="animate-spin" />
      <span>Vidéo en cours de préparation…</span>
    </div>
  );
}

export function fmtDuration(sec: number | null | undefined) {
  if (!sec || !Number.isFinite(sec)) return null;
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Ratio d'affichage d'un média, borné pour rester lisible dans le fil. */
export function ratioOf(m: MediaRef | null, fallback = '4 / 5') {
  if (!m?.width || !m.height) return fallback;
  const r = Math.min(1.91, Math.max(0.8, m.width / m.height));
  return String(r);
}

/** Format d'un média montré en entier : le sien, entre 9:16 et 1,91:1 (4:3 s'il est inconnu). */
export function wholeRatio(media: MediaRef) {
  return String(media.width && media.height ? Math.min(1.91, Math.max(0.5625, media.width / media.height)) : 4 / 3);
}

/**
 * Image ou vidéo montrée **en entier** (jeu, mèmes) : le cadre prend le format du média (9:16 à 1,91:1),
 * sa hauteur est plafonnée, et les bandes éventuelles sont remplies par un fond flouté du média.
 */
export function WholeMedia({
  media,
  className,
  autoPlay,
  sizes,
  maxH = 'min(58svh, 520px)',
  children,
}: {
  media: MediaRef;
  className?: string;
  autoPlay?: boolean;
  sizes?: string;
  maxH?: string;
  children?: ReactNode;
}) {
  const ratio = wholeRatio(media);
  const backdrop = media.kind === 'video' ? media.poster : media.url;
  return (
    <div className={cx('relative w-full overflow-hidden rounded-3xl bg-[#0b0f14]', className)} style={{ aspectRatio: ratio, maxHeight: maxH }}>
      {backdrop && <img src={backdrop} alt="" aria-hidden loading="lazy" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl" />}
      <MediaView media={media} fit="contain" autoPlay={autoPlay} sizes={sizes} className="relative" />
      {children}
    </div>
  );
}

/** Hauteur maximale d'une photo ou vidéo dans le fil : jamais plus haute qu'une bonne part de l'écran. */
export const POST_MEDIA_MAX_H = 'min(64svh, 560px)';

/**
 * Cadre d'une photo ou vidéo de post : format 1,91:1 à 4:5, et hauteur plafonnée (le centre est gardé,
 * l'image entière reste visible en plein écran).
 */
export function mediaFrame(m: MediaRef | null, fallback = '4 / 5'): CSSProperties {
  return { aspectRatio: ratioOf(m, fallback), maxHeight: POST_MEDIA_MAX_H };
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
      <p className="m-0 max-w-[360px] text-[0.9375rem] leading-normal text-pretty text-mute">{text}</p>
      {children}
    </div>
  );
}

/** Écran ou bloc qui n'a pas pu se charger (réseau coupé, serveur…) : explication et « Réessayer ». */
export function ErrorCard({ onRetry, title = 'Chargement impossible', text = 'Vérifie ta connexion, puis réessaie.' }: { onRetry: () => void; title?: string; text?: string }) {
  return (
    <EmptyCard icon={<WifiSlash size={28} />} title={title} text={text}>
      <PrimaryBtn onClick={onRetry} className="px-6">
        Réessayer
      </PrimaryBtn>
    </EmptyCard>
  );
}

/** Variante en ligne, dans une liste ou une section de réglages. */
export function ErrorLine({ onRetry, text = 'Chargement impossible.' }: { onRetry: () => void; text?: string }) {
  return (
    <div role="alert" className="flex items-center gap-2 px-3 py-1 text-sm text-mute">
      <span className="min-w-0 flex-1">{text}</span>
      <button type="button" onClick={onRetry} className="tap h-11 flex-none rounded-[22px] border-0 bg-soft px-3.5 text-[0.8125rem] font-bold text-acc">
        Réessayer
      </button>
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
        'tap flex h-[52px] items-center justify-center gap-2 rounded-[26px] border-0 px-5 text-[0.9375rem] font-bold transition-[transform,background,color] duration-200 active:scale-[.97]',
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
    { bg: 'bg-tint text-ink', size: 'text-[1.375rem]' },
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
            <div className="max-w-full overflow-hidden text-center text-[0.8125rem] leading-tight font-bold text-ellipsis">{e.label}</div>
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
export function useFilePicker(accept: string, onPick: (f: File) => void, capture?: 'user' | 'environment', multiple = false) {
  const ref = useRef<HTMLInputElement | null>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept={accept}
      capture={capture}
      multiple={multiple}
      className="hidden"
      onChange={(e) => {
        for (const f of Array.from(e.target.files ?? []).slice(0, multiple ? 10 : 1)) onPick(f);
        e.target.value = '';
      }}
    />
  );
  return { input, open: () => ref.current?.click() };
}
