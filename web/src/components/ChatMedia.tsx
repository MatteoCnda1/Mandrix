import type { MediaRef } from '@mandrix/shared';
import { Pause, Play, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useSwipeDown } from '../lib/gestures';
import { cx, fmtDuration, MediaView, Portal, VideoProcessing } from './ui';

/** Barres de « forme d'onde » stables pour un vocal (dérivées de son identifiant). */
function bars(id: string, n = 30) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return Array.from({ length: n }, (_, i) => {
    h = (h * 1103515245 + 12345) >>> 0;
    const base = 0.3 + ((h >>> 8) % 70) / 100;
    const envelope = Math.sin((Math.PI * (i + 1)) / (n + 1)) * 0.5 + 0.5;
    return Math.max(0.18, Math.min(1, base * envelope + 0.1));
  });
}

let playingAudio: HTMLAudioElement | null = null;

/** Lecteur de message vocal : lecture/pause, progression sur la forme d'onde, durée. */
export function VoicePlayer({ media, mine }: { media: MediaRef; mine: boolean }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(media.duration ?? 0);
  const shape = bars(media.id);
  const progress = duration ? Math.min(1, time / duration) : 0;

  useEffect(() => () => ref.current?.pause(), []);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) {
      // Un seul vocal à la fois.
      if (playingAudio && playingAudio !== a) playingAudio.pause();
      playingAudio = a;
      void a.play();
    } else a.pause();
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = ref.current;
    if (!a || !duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration;
    setTime(a.currentTime);
  };

  return (
    <div className="flex w-[min(250px,62vw)] items-center gap-2.5 py-0.5">
      <button
        type="button"
        aria-label={playing ? 'Mettre en pause' : 'Écouter le message vocal'}
        onClick={toggle}
        className={cx(
          'tap grid h-10 w-10 flex-none place-items-center rounded-full border-0 transition-transform active:scale-90',
          mine ? 'bg-white text-brand' : 'bg-brand text-white',
        )}
      >
        {playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
      </button>
      <div className="tap flex h-9 min-w-0 flex-1 items-center gap-[2px]" onClick={seek} role="presentation">
        {shape.map((v, i) => (
          <span
            key={i}
            className={cx(
              'w-[3px] flex-1 rounded-full transition-colors',
              i / shape.length < progress ? (mine ? 'bg-white' : 'bg-brand') : mine ? 'bg-white/40' : 'bg-ink/25',
            )}
            style={{ height: `${v * 100}%` }}
          />
        ))}
      </div>
      <span className={cx('w-9 flex-none text-right text-xs font-bold tabular-nums', mine ? 'text-white/90' : 'text-mute')}>
        {fmtDuration(playing || time ? time : duration) ?? '0:00'}
      </span>
      <audio
        ref={ref}
        src={media.url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setTime(0);
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
      />
    </div>
  );
}

/** Photo ou vidéo envoyée dans une conversation (miniature cliquable). */
export function MessagePhotoVideo({ media, onOpen }: { media: MediaRef; onOpen: () => void }) {
  const ratio = media.width && media.height ? Math.min(1.8, Math.max(0.6, media.width / media.height)) : media.kind === 'video' ? 0.75 : 1;
  if (media.kind === 'video' && media.processing) {
    return (
      <div className="w-[min(240px,62vw)] overflow-hidden rounded-[18px]" style={{ aspectRatio: String(ratio) }}>
        <VideoProcessing />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={media.kind === 'video' ? 'Lire la vidéo' : 'Voir la photo'}
      className="tap ph relative block w-[min(240px,62vw)] overflow-hidden rounded-[18px] border-0 p-0"
      style={{ aspectRatio: String(ratio) }}
    >
      {media.kind === 'video' ? (
        <>
          {media.poster ? (
            <img src={media.poster} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <video src={`${media.url}#t=0.1`} muted playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover" />
          )}
          <span className="absolute inset-0 grid place-items-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-white/90 text-night">
              <Play size={20} weight="fill" />
            </span>
          </span>
          {media.duration && (
            <span className="absolute right-2 bottom-2 rounded-full bg-black/55 px-2 py-0.5 text-[0.6875rem] font-bold text-white">{fmtDuration(media.duration)}</span>
          )}
        </>
      ) : (
        <img src={media.url} srcSet={media.srcSet ?? undefined} sizes="240px" alt="Photo" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      )}
    </button>
  );
}

/** Affichage plein écran d'une photo ou d'une vidéo de conversation. */
export function MediaLightbox({ media, onClose }: { media: MediaRef; onClose: () => void }) {
  const swipe = useSwipeDown(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <Portal>
      <div
        className="fixed inset-0 z-[55] grid animate-fade place-items-center p-2"
        style={{ background: `rgba(0,0,0,${0.95 * (1 - Math.min(swipe.dy, 300) / 400)})` }}
        role="dialog"
        aria-modal="true"
        aria-label={media.kind === 'video' ? 'Vidéo' : 'Photo'}
        onClick={onClose}
      >
        <div
          {...swipe.handlers}
          className="relative h-full max-h-[100dvh] w-full max-w-[900px] touch-none"
          style={{ transform: swipe.dy ? `translateY(${swipe.dy}px) scale(${1 - Math.min(swipe.dy, 400) / 1600})` : undefined, transition: swipe.dy ? 'none' : 'transform .25s ease' }}
          onClick={(e) => e.stopPropagation()}
        >
          <MediaView media={media} fit="contain" controls={media.kind === 'video'} autoPlay={media.kind === 'video'} muted={false} loop={false} />
        </div>
        <button
          type="button"
          aria-label="Fermer"
          onClick={onClose}
          className="tap absolute right-4 grid h-11 w-11 place-items-center rounded-full border-0 bg-white/15 text-white backdrop-blur"
          style={{ top: 'calc(14px + env(safe-area-inset-top))' }}
        >
          <X size={20} />
        </button>
      </div>
    </Portal>
  );
}
