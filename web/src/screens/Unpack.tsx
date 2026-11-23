import type { Shot } from '@mandrix/shared';
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  CaretLeft,
  CaretRight,
  CheckCircle,
  DownloadSimple,
  Heart,
  Lightning,
  LockSimple,
  Package,
  Play,
  Sticker,
  X,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Avatar, MediaView, Portal, ScreenLoader, cx } from '../components/ui';
import { removeFromPool, sendToPool, toggleShotLike, useMe, useUnpack } from '../lib/data';
import { countdown, fmtCount, plural } from '../lib/format';
import { useMediaGestures } from '../lib/gestures';
import { lockScroll, useScrollLock } from '../lib/scrollLock';
import { useNow } from '../lib/hooks';
import { openPool } from '../lib/store';

function storageKey(revealAt: string) {
  return `mandrix.unpacked.${revealAt}`;
}

function ShotViewer({ photos, index, onClose }: { photos: Shot[]; index: number; onClose: () => void }) {
  const [i, setI] = useState(index);
  const shot = photos[i];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((x) => Math.min(photos.length - 1, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photos.length, onClose]);
  useScrollLock();
  const gestures = useMediaGestures({
    onSwipeDown: onClose,
    onSwipeX: (dir) => setI((x) => Math.max(0, Math.min(photos.length - 1, x - dir))),
  });
  if (!shot) return null;
  const nav = 'tap absolute top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border-0 bg-white/15 text-white backdrop-blur';
  return (
    <div className="fixed inset-0 z-[45] grid animate-fade place-items-center bg-[rgba(8,12,17,.94)] p-3" role="dialog" aria-modal="true" aria-label={`Photo de ${shot.author.displayName}`}>
      <div className="relative flex h-[min(88vh,820px)] w-full max-w-[520px] animate-drop flex-col overflow-hidden rounded-[36px] bg-night" style={gestures.style}>
        <div className="flex items-center gap-2.5 p-3.5 text-white">
          <Avatar user={shot.author} size={40} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[0.9375rem] font-bold">{shot.author.displayName}</div>
            <div className="text-[0.8125rem] text-fog">
              {shot.day} · {new Date(shot.takenAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              {shot.onTime && <span className="ml-1.5 font-bold text-ember">· ⚡ pile à l’heure</span>}
            </div>
          </div>
          <button type="button" aria-label="Fermer" onClick={onClose} className="tap grid h-11 w-11 place-items-center rounded-full border-0 bg-white/15 text-white">
            <X size={20} />
          </button>
        </div>
        <div className="relative min-h-0 flex-1">
          <div {...gestures.handlers} className="absolute inset-0 touch-none select-none">
            <MediaView key={shot.id} media={shot.media} fit="contain" />
          </div>
          {i > 0 && (
            <button type="button" aria-label="Photo précédente" onClick={() => setI(i - 1)} className={cx(nav, 'left-3')}>
              <CaretLeft size={20} />
            </button>
          )}
          {i < photos.length - 1 && (
            <button type="button" aria-label="Photo suivante" onClick={() => setI(i + 1)} className={cx(nav, 'right-3')}>
              <CaretRight size={20} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 p-3.5">
          <button
            type="button"
            onClick={() => toggleShotLike(shot)}
            className="tap flex h-12 items-center gap-2 rounded-3xl border-0 bg-white/15 px-4 text-[0.9375rem] font-bold text-white active:scale-95"
          >
            <Heart size={22} weight={shot.liked ? 'fill' : 'regular'} className={cx(shot.liked && 'animate-pop text-heartlite')} />
            {fmtCount(shot.likes)}
          </button>
          <span className="ml-1 text-[0.8125rem] text-fog">
            {i + 1}/{photos.length}
          </span>
          <button
            type="button"
            onClick={() => (shot.pool ? removeFromPool({ shotId: shot.id }) : openPool({ shotId: shot.id }))}
            className={cx('tap ml-auto flex h-12 items-center gap-2 rounded-3xl border-0 px-4 text-[0.9375rem] font-bold active:scale-95', shot.pool ? 'bg-brand text-white' : 'bg-white text-night')}
          >
            {shot.pool ? <CheckCircle size={20} weight="fill" /> : <Sticker size={20} />}
            {shot.pool ? 'Dans le pool' : 'Pool'}
          </button>
        </div>
      </div>
    </div>
  );
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Rétrospective de la semaine : diaporama plein écran façon stories, puis le top 3. */
function Retro({ photos, top, label, onClose }: { photos: Shot[]; top: Shot[]; label: string; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const last = photos.length; // dernière diapositive : le top 3
  const go = (d: number) => setI((x) => Math.max(0, Math.min(last, x + d)));

  useEffect(() => {
    if (paused || i >= last) return;
    const t = setTimeout(() => go(1), 2800);
    return () => clearTimeout(t);
  }, [i, paused, last]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === ' ') setPaused((p) => !p);
    };
    window.addEventListener('keydown', onKey);
    const release = lockScroll();
    return () => {
      window.removeEventListener('keydown', onKey);
      release();
    };
  }, [onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  const gestures = useMediaGestures({
    onTap: (zone) => go(zone === 'left' ? -1 : 1),
    onHold: (on) => setPaused(on),
    onSwipeDown: onClose,
    onSwipeX: (dir) => go(-dir),
  });
  const shot = photos[i];
  const next = photos[i + 1];
  return (
    <div className="fixed inset-0 z-[45] grid animate-fade place-items-center bg-[rgba(8,12,17,.94)] p-3" role="dialog" aria-modal="true" aria-label={`Rétrospective : ${label}`}>
      <div className="relative h-[min(88vh,820px)] w-full max-w-[460px] animate-drop overflow-hidden rounded-[36px] bg-night" style={gestures.style}>
        {shot ? (
          <>
            <div key={shot.id} className="absolute inset-0 overflow-hidden">
              <img src={shot.media.url} alt="" className="h-full w-full animate-ken object-cover" />
            </div>
            {next && <link rel="prefetch" href={next.media.url} />}
            <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/75 to-transparent" />
            <div className="absolute right-5 bottom-6 left-5 flex items-center gap-3 text-white">
              <Avatar user={shot.author} size={44} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[1.0625rem] font-extrabold">{shot.author.displayName}</div>
                <div className="text-[0.8125rem] text-fog">
                  {shot.day} · {timeOf(shot.takenAt)}
                  {shot.onTime && <span className="ml-1.5 font-bold text-ember">⚡ pile à l’heure</span>}
                </div>
              </div>
              <span className="flex items-center gap-1 rounded-full bg-white/15 px-3 py-1.5 text-[0.8125rem] font-bold backdrop-blur">
                <Heart size={14} weight="fill" className="text-heartlite" /> {fmtCount(shot.likes)}
              </span>
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-5 bg-gradient-to-b from-[#0E2A47] to-night px-6 text-center text-white">
            <div className="text-[0.8125rem] font-bold tracking-wide text-ice uppercase">{label}</div>
            <div className="text-[1.75rem] leading-tight font-extrabold tracking-[-.03em]">Le top de la semaine</div>
            <div className="grid w-full grid-cols-3 gap-2.5">
              {top.map((t, k) => (
                <div key={t.id} className="relative aspect-[3/4] overflow-hidden rounded-[20px] bg-white/10">
                  <img src={t.media.url} srcSet={t.media.srcSet ?? undefined} sizes="200px" alt="" className="h-full w-full object-cover" />
                  <span className={cx('absolute top-2 left-2 grid h-8 w-8 place-items-center rounded-full text-sm font-extrabold', k === 0 ? 'bg-brand text-white' : 'bg-white text-night')}>
                    {k + 1}
                  </span>
                  <span className="absolute inset-x-1.5 bottom-1.5 truncate rounded-full bg-black/55 px-2 py-1 text-[0.6875rem] font-bold">@{t.author.username}</span>
                </div>
              ))}
            </div>
            <div className="text-sm text-fog">{plural(photos.length, 'photo', 'photos')} cette semaine. Rendez-vous dimanche prochain !</div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setI(0)} className="tap flex h-12 items-center gap-2 rounded-3xl border-0 bg-white/15 px-5 text-[0.9375rem] font-bold text-white">
                <ArrowClockwise size={18} /> Revoir
              </button>
              <button type="button" onClick={onClose} className="tap h-12 rounded-3xl border-0 bg-white px-6 text-[0.9375rem] font-bold text-night">
                Fermer
              </button>
            </div>
          </div>
        )}

        <div className="absolute top-3.5 right-[18px] left-[18px] h-1 overflow-hidden rounded-sm bg-white/20">
          <div className="h-full rounded-sm bg-white transition-[width] duration-300" style={{ width: `${((i + 1) / (last + 1)) * 100}%` }} />
        </div>
        <div className="absolute top-7 right-3.5 left-5 flex items-center gap-2 text-white">
          <span className="text-[0.8125rem] font-bold tabular-nums [text-shadow:0_1px_8px_rgba(0,0,0,.5)]">
            {Math.min(i + 1, last)}/{last}
          </span>
          {paused && shot && <span className="rounded-full bg-black/40 px-2.5 py-1 text-xs font-bold">En pause</span>}
          <button type="button" aria-label="Fermer la rétrospective" onClick={onClose} className="tap ml-auto grid h-11 w-11 place-items-center rounded-full border-0 bg-white/15 text-white backdrop-blur">
            <X size={20} />
          </button>
        </div>
        {shot && (
          <>
            <div {...gestures.handlers} aria-hidden className="absolute inset-x-0 top-20 bottom-28 cursor-pointer touch-none select-none [-webkit-touch-callout:none]" />
            <button type="button" onClick={() => go(-1)} className="sr-only">
              Photo précédente
            </button>
            <button type="button" onClick={() => go(1)} className="sr-only">
              Photo suivante
            </button>
            <button type="button" onClick={() => setPaused((p) => !p)} className="sr-only">
              {paused ? 'Reprendre' : 'Mettre en pause'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function Unpack() {
  const { data, isLoading } = useUnpack();
  const { data: me } = useMe();
  const [retro, setRetro] = useState(false);
  const now = useNow(1000);
  const [revealed, setRevealed] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const [topSending, setTopSending] = useState(false);
  const r = data?.revealed;

  useEffect(() => {
    if (!r) return;
    try {
      setRevealed(localStorage.getItem(storageKey(r.revealAt)) === '1');
    } catch {
      /* stockage indisponible */
    }
  }, [r?.revealAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading || !data) return <ScreenLoader />;
  const cd = countdown(data.nextRevealAt, now);

  const toggle = () => {
    if (!r) return;
    const next = !revealed;
    setRevealed(next);
    try {
      localStorage.setItem(storageKey(r.revealAt), next ? '1' : '0');
    } catch {
      /* stockage indisponible */
    }
  };

  const topAllPooled = !!r && r.top.length > 0 && r.top.every((s) => s.pool);
  const sendTop = async () => {
    if (!r || topAllPooled) return;
    setTopSending(true);
    for (const s of r.top.filter((x) => !x.pool)) await sendToPool({ shotId: s.id }, 'public');
    setTopSending(false);
  };

  const locked = !r;
  const label = r?.weekLabel ?? data.current.weekLabel;
  const count = r?.count ?? data.current.count;
  const people = r?.people ?? data.current.people;
  const backs = locked ? Math.min(24, Math.max(6, data.current.count)) : 0;

  return (
    <div data-screen-label="Déballage" className="flex animate-in flex-col gap-3.5">
      <div className="card flex flex-wrap items-center gap-3.5 p-[18px]">
        <div className="min-w-0 flex-[1_1_220px]">
          <div className="text-[1.375rem] font-extrabold tracking-[-.02em]">{label}</div>
          <div className="text-sm text-mute">
            {plural(count, 'photo prise', 'photos prises')} par {plural(people, 'personne', 'personnes')} · {cd.line}
          </div>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={locked}
          className={cx(
            'tap flex h-[52px] items-center gap-2 rounded-[26px] border-0 px-[22px] text-[0.9375rem] font-bold transition-[background,color,transform] duration-[400ms] active:scale-[.96]',
            locked ? 'cursor-not-allowed bg-line text-mute' : revealed ? 'bg-ink text-inv' : 'bg-brand text-white shadow-blue',
          )}
        >
          {locked ? <LockSimple size={18} weight="fill" /> : revealed ? <ArrowCounterClockwise size={18} /> : <Package size={18} weight="fill" />}
          <span>{locked ? 'Ouverture dimanche à 20h' : revealed ? 'Refermer' : 'Déballer la semaine'}</span>
        </button>
      </div>

      {r && revealed && r.top.length > 0 && (
        <div className="card flex animate-in flex-col gap-3.5 p-[18px]" style={{ animationDelay: '1s', animationDuration: '.6s' }}>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="mr-auto text-xl font-extrabold tracking-[-.02em]">Récap du dimanche</div>
            {r.busiestDay && <span className="rounded-[14px] bg-soft px-3 py-1.5 text-xs font-bold">Jour le plus actif : {r.busiestDay}</span>}
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2">
            {r.top.map((t, k) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setViewer(r.photos.findIndex((p) => p.id === t.id))}
                className="tap flex items-center gap-2.5 rounded-[26px] border-0 bg-soft p-2 text-left text-ink"
              >
                <div className={cx('grid h-11 w-11 flex-none place-items-center rounded-full text-lg font-extrabold', k === 0 ? 'bg-brand text-white' : 'bg-ink text-inv')}>{k + 1}</div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">@{t.author.username}</div>
                  <div className="text-xs text-mute">
                    {t.day} · {plural(t.likes, 'j’aime', 'j’aime')}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setRetro(true)}
            className="tap flex h-[52px] items-center justify-center gap-2 rounded-[26px] border-0 bg-brand text-[0.9375rem] font-bold text-white shadow-blue transition-transform active:scale-[.97]"
          >
            <Play size={20} weight="fill" />
            <span>Rétrospective de la semaine</span>
          </button>
          <div className="grid grid-cols-2 gap-2">
            {r.photos.some((p) => p.author.id === me?.id) && (
              <a
                href={`/api/pellicule/archive?revealAt=${encodeURIComponent(r.revealAt)}&scope=mine`}
                download
                className="tap flex h-12 items-center justify-center gap-2 rounded-3xl bg-soft text-sm font-bold text-ink no-underline hover:text-ink active:scale-[.97]"
              >
                <DownloadSimple size={18} /> Mes photos
              </a>
            )}
            <a
              href={`/api/pellicule/archive?revealAt=${encodeURIComponent(r.revealAt)}&scope=all`}
              download
              className={cx(
                'tap flex h-12 items-center justify-center gap-2 rounded-3xl bg-soft text-sm font-bold text-ink no-underline hover:text-ink active:scale-[.97]',
                !r.photos.some((p) => p.author.id === me?.id) && 'col-span-2',
              )}
            >
              <DownloadSimple size={18} /> Tout l’album
            </a>
          </div>
          <button
            type="button"
            onClick={sendTop}
            disabled={topSending}
            className={cx(
              'tap flex h-[52px] items-center justify-center gap-2 rounded-[26px] border-0 text-[0.9375rem] font-bold transition-[background,color,transform] duration-[400ms] active:scale-[.97]',
              topAllPooled ? 'bg-brand text-white' : 'bg-ink text-inv',
            )}
          >
            {topAllPooled ? <CheckCircle size={20} weight="fill" /> : <Sticker size={20} />}
            <span>{topAllPooled ? 'Top 3 envoyé dans le pool' : 'Envoyer le top 3 dans le pool'}</span>
          </button>
        </div>
      )}

      {r && r.photos.length === 0 && <div className="card p-6 text-center text-[0.9375rem] text-mute">Personne n’a pris de photo cette semaine.</div>}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
        {(r ? r.photos : Array.from({ length: backs }, (_, i) => ({ id: `b${i}` }) as unknown as Shot)).map((ph, i) => {
          const open = !!r && revealed;
          return (
            <div key={ph.id} className="aspect-[3/4] [perspective:900px]">
              <div
                className="relative h-full w-full [transform-style:preserve-3d]"
                style={{
                  transform: open ? 'rotateY(0deg)' : 'rotateY(180deg)',
                  transition: `transform .8s cubic-bezier(.2,.8,.2,1) ${open ? Math.min(i, 30) * 0.07 : 0}s`,
                }}
              >
                <div className="absolute inset-0 grid [transform:rotateY(180deg)] place-items-center rounded-3xl bg-brand text-white shadow-[0_10px_26px_rgba(14,118,198,.25)] [backface-visibility:hidden]">
                  <LockSimple size={28} weight="fill" />
                </div>
                {r && (
                  <div
                    className="ph tap absolute inset-0 flex flex-col justify-end overflow-hidden rounded-3xl p-2.5 shadow-[0_10px_26px_rgba(20,90,160,.12)] [backface-visibility:hidden]"
                    onClick={() => open && setViewer(i)}
                  >
                    {open && <MediaView media={ph.media} className="absolute inset-0" sizes="(max-width: 700px) 34vw, 220px" />}
                    {open && ph.onTime && (
                      <span className="absolute top-2 left-2 flex h-7 items-center gap-1 rounded-full bg-gradient-to-r from-ember to-heart px-2.5 text-[0.6875rem] font-extrabold text-white shadow-[0_4px_12px_rgba(229,72,77,.35)]">
                        <Lightning size={12} weight="fill" /> Pile à l’heure
                      </span>
                    )}
                    <div className="relative flex items-center gap-1.5">
                      <span className="flex h-9 min-w-0 flex-1 items-center truncate rounded-[18px] bg-card px-3 text-xs font-bold">
                        @{ph.author.username} · {ph.day}
                      </span>
                      <button
                        type="button"
                        aria-label="Envoyer dans le pool"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (ph.pool) removeFromPool({ shotId: ph.id });
                          else openPool({ shotId: ph.id });
                        }}
                        className={cx('tap grid h-11 w-11 flex-none place-items-center rounded-full border-0 transition-[background,transform] duration-300 active:scale-[.88]', ph.pool ? 'bg-brand text-white' : 'bg-ink text-inv')}
                      >
                        {ph.pool ? <CheckCircle size={20} weight="fill" /> : <Sticker size={20} />}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {r && data.current.count > 0 && (
        <div className="flex items-center gap-3 rounded-[28px] bg-glass px-4 py-3 text-sm font-semibold text-mute">
          <LockSimple size={18} weight="fill" className="text-acc" />
          Cette semaine : {plural(data.current.count, 'photo scellée', 'photos scellées')} par {plural(data.current.people, 'personne', 'personnes')}
        </div>
      )}
      {viewer !== null && r && (
        <Portal>
          <ShotViewer photos={r.photos} index={viewer} onClose={() => setViewer(null)} />
        </Portal>
      )}
      {retro && r && (
        <Portal>
          <Retro photos={r.photos} top={r.top} label={r.weekLabel} onClose={() => setRetro(false)} />
        </Portal>
      )}
    </div>
  );
}
