import type { Shot } from '@mandrix/shared';
import { ArrowCounterClockwise, CaretLeft, CaretRight, CheckCircle, Heart, LockSimple, Package, Sticker, X } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Avatar, MediaView, ScreenLoader, cx } from '../components/ui';
import { removeFromPool, sendToPool, toggleShotLike, useUnpack } from '../lib/data';
import { countdown, fmtCount, plural } from '../lib/format';
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
  if (!shot) return null;
  const nav = 'tap absolute top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border-0 bg-white/15 text-white backdrop-blur';
  return (
    <div className="fixed inset-0 z-[45] grid animate-fade place-items-center bg-[rgba(8,12,17,.94)] p-3" role="dialog" aria-modal="true">
      <div className="relative flex h-[min(88vh,820px)] w-full max-w-[520px] animate-drop flex-col overflow-hidden rounded-[36px] bg-night">
        <div className="flex items-center gap-2.5 p-3.5 text-white">
          <Avatar user={shot.author} size={40} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-bold">{shot.author.displayName}</div>
            <div className="text-[13px] text-fog">
              {shot.day} · {new Date(shot.takenAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
          <button type="button" aria-label="Fermer" onClick={onClose} className="tap grid h-11 w-11 place-items-center rounded-full border-0 bg-white/15 text-white">
            <X size={20} />
          </button>
        </div>
        <div className="relative min-h-0 flex-1">
          <MediaView key={shot.id} media={shot.media} fit="contain" />
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
            className="tap flex h-12 items-center gap-2 rounded-3xl border-0 bg-white/15 px-4 text-[15px] font-bold text-white active:scale-95"
          >
            <Heart size={22} weight={shot.liked ? 'fill' : 'regular'} className={cx(shot.liked && 'animate-pop text-heartlite')} />
            {fmtCount(shot.likes)}
          </button>
          <span className="ml-1 text-[13px] text-fog">
            {i + 1}/{photos.length}
          </span>
          <button
            type="button"
            onClick={() => (shot.pool ? removeFromPool({ shotId: shot.id }) : openPool({ shotId: shot.id }))}
            className={cx('tap ml-auto flex h-12 items-center gap-2 rounded-3xl border-0 px-4 text-[15px] font-bold active:scale-95', shot.pool ? 'bg-brand text-white' : 'bg-white text-night')}
          >
            {shot.pool ? <CheckCircle size={20} weight="fill" /> : <Sticker size={20} />}
            {shot.pool ? 'Dans le pool' : 'Pool'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Unpack() {
  const { data, isLoading } = useUnpack();
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
          <div className="text-[22px] font-extrabold tracking-[-.02em]">{label}</div>
          <div className="text-sm text-mute">
            {plural(count, 'photo prise', 'photos prises')} par {plural(people, 'personne', 'personnes')} · {cd.line}
          </div>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={locked}
          className={cx(
            'tap flex h-[52px] items-center gap-2 rounded-[26px] border-0 px-[22px] text-[15px] font-bold transition-[background,color,transform] duration-[400ms] active:scale-[.96]',
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
            onClick={sendTop}
            disabled={topSending}
            className={cx(
              'tap flex h-[52px] items-center justify-center gap-2 rounded-[26px] border-0 text-[15px] font-bold transition-[background,color,transform] duration-[400ms] active:scale-[.97]',
              topAllPooled ? 'bg-brand text-white' : 'bg-ink text-inv',
            )}
          >
            {topAllPooled ? <CheckCircle size={20} weight="fill" /> : <Sticker size={20} />}
            <span>{topAllPooled ? 'Top 3 envoyé dans le pool' : 'Envoyer le top 3 dans le pool'}</span>
          </button>
        </div>
      )}

      {r && r.photos.length === 0 && <div className="card p-6 text-center text-[15px] text-mute">Personne n’a pris de photo cette semaine.</div>}

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
                    {open && <MediaView media={ph.media} className="absolute inset-0" />}
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
      {viewer !== null && r && <ShotViewer photos={r.photos} index={viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}
