import { MUSIC_CLIP_LENGTHS, type MusicTrack, type StoryMusicChoice } from '@mandrix/shared';
import { ArrowLeft, CheckCircle, MagnifyingGlass, MusicNotes, Pause, Play, X } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useDebounced } from '../lib/hooks';
import { cx } from './ui';

// Musique d'une story (#104) : recherche dans la bibliothèque Plex, puis choix du passage (15 ou 30 s).

export interface PickedMusic extends StoryMusicChoice {
  track: MusicTrack;
}

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const previewUrl = (m: { track: MusicTrack; start: number; duration: number }) =>
  `/api/music/tracks/${m.track.id}/preview?start=${Math.round(m.start)}&len=${m.duration}`;

function Cover({ track, size }: { track: MusicTrack; size: number }) {
  return track.cover ? (
    <img src={track.cover} alt="" className="flex-none rounded-[12px] object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="grid flex-none place-items-center rounded-[12px] bg-white/10" style={{ width: size, height: size }}>
      <MusicNotes size={size * 0.45} />
    </span>
  );
}

/** Choix du passage : fenêtre de 15 ou 30 s à placer sur la durée du titre, écoute du passage. */
function Passage({ track, initial, onBack, onPick }: { track: MusicTrack; initial?: PickedMusic | null; onBack: () => void; onPick: (m: PickedMusic) => void }) {
  const [duration, setDuration] = useState<StoryMusicChoice['duration']>(initial?.duration ?? 15);
  const len = Math.min(duration, track.duration);
  const max = Math.max(0, track.duration - len);
  // Par défaut, vers le tiers du morceau (souvent après l'intro).
  const [start, setStart] = useState(() => Math.min(max, initial?.start ?? Math.round(track.duration / 3)));
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const settled = useDebounced(start, 450);

  const play = () => {
    const a = audio.current;
    if (!a) return;
    setLoading(true);
    a.src = previewUrl({ track, start: settled, duration: len });
    a.play().then(
      () => setPlaying(true),
      () => setPlaying(false),
    );
  };
  // Le passage bouge : on réécoute le nouveau (si on écoutait déjà).
  useEffect(() => {
    if (playing) play();
  }, [settled, len]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => audio.current?.pause(), []);

  const left = max ? (start / track.duration) * 100 : 0;
  const width = (len / Math.max(1, track.duration)) * 100;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 px-5" style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom))' }}>
      <audio
        ref={audio}
        onPlaying={() => setLoading(false)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => {
          setLoading(false);
          setPlaying(false);
        }}
      />
      <div className="flex items-center gap-3">
        <button type="button" aria-label="Retour à la recherche" onClick={onBack} className="tap grid h-11 w-11 flex-none place-items-center rounded-full border-0 bg-white/15 text-white">
          <ArrowLeft size={18} weight="bold" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[0.9375rem] font-extrabold">{track.title}</div>
          <div className="truncate text-[0.8125rem] text-white/70">{track.artist}</div>
        </div>
      </div>
      <div className="mx-auto">
        <Cover track={track} size={180} />
      </div>
      <div className="flex justify-center gap-1.5" role="group" aria-label="Longueur de l’extrait">
        {MUSIC_CLIP_LENGTHS.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={duration === n}
            disabled={n > track.duration}
            onClick={() => {
              setDuration(n);
              setStart((s) => Math.min(s, Math.max(0, track.duration - n)));
            }}
            className={cx('tap h-11 rounded-full border-0 px-5 text-sm font-bold disabled:opacity-40', duration === n ? 'bg-white text-black' : 'bg-white/15 text-white')}
          >
            {n} s
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {/* Frise du titre et fenêtre du passage. */}
        <div className="relative h-12 overflow-hidden rounded-[14px] bg-white/10" aria-hidden>
          {Array.from({ length: 48 }, (_, i) => (
            <span key={i} className="absolute bottom-0 w-[1.2%] rounded-t-sm bg-white/25" style={{ left: `${i * 2.08}%`, height: `${30 + ((i * 37) % 60)}%` }} />
          ))}
          <span className="absolute inset-y-0 rounded-[12px] border-2 border-solid border-white bg-white/25 transition-[left] duration-100" style={{ left: `${left}%`, width: `${width}%` }} />
        </div>
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={start}
          disabled={!max}
          onChange={(e) => setStart(Number(e.target.value))}
          aria-label="Début du passage"
          aria-valuetext={`${clock(start)} à ${clock(start + len)}`}
          className="w-full accent-white"
        />
        <div className="flex justify-between text-xs font-semibold text-white/75 tabular-nums">
          <span>
            {clock(start)} → {clock(start + len)}
          </span>
          <span>{clock(track.duration)}</span>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-center gap-2.5">
        <button
          type="button"
          onClick={() => (playing ? audio.current?.pause() : play())}
          className="tap flex h-12 items-center gap-2 rounded-full border-0 bg-white/15 px-5 text-sm font-bold text-white"
          aria-label={playing ? 'Arrêter l’écoute' : 'Écouter ce passage'}
        >
          {playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
          {loading ? 'Chargement…' : playing ? 'Pause' : 'Écouter'}
        </button>
        <button
          type="button"
          onClick={() => {
            audio.current?.pause();
            onPick({ track, trackId: track.id, start, duration });
          }}
          className="tap flex h-12 items-center gap-2 rounded-full border-0 bg-white px-5 text-sm font-extrabold text-black"
        >
          <CheckCircle size={18} weight="fill" /> Utiliser ce passage
        </button>
      </div>
    </div>
  );
}

/** Feuille plein écran (dans le créateur de story) : rechercher un titre, puis choisir le passage. */
export function MusicPicker({ initial, onClose, onPick }: { initial?: PickedMusic | null; onClose: () => void; onPick: (m: PickedMusic) => void }) {
  const [q, setQ] = useState('');
  const [track, setTrack] = useState<MusicTrack | null>(initial?.track ?? null);
  const dq = useDebounced(q.trim(), 300);
  const { data, isFetching, error } = useQuery({
    queryKey: ['music-search', dq],
    queryFn: () => api<MusicTrack[]>(`/api/music/search?q=${encodeURIComponent(dq)}`),
    enabled: dq.length >= 2,
    staleTime: 60_000,
  });
  // Échap ferme ce choix seulement (le créateur de story, lui, ignore la touche tant qu'il est ouvert).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div data-music-picker className="absolute inset-0 z-20 flex flex-col bg-[#0b0f14] text-white" role="dialog" aria-label="Ajouter une musique">
      <div className="flex flex-none items-center gap-2 px-4 pb-3" style={{ paddingTop: 'calc(10px + env(safe-area-inset-top))' }}>
        <div className="flex-1 text-[0.9375rem] font-bold">{track ? 'Choisir le passage' : 'Ajouter une musique'}</div>
        <button type="button" aria-label="Fermer" onClick={onClose} className="tap grid h-11 w-11 place-items-center rounded-full border-0 bg-white/15 text-white">
          <X size={20} weight="bold" />
        </button>
      </div>
      {track ? (
        <Passage track={track} initial={initial?.track.id === track.id ? initial : null} onBack={() => setTrack(null)} onPick={onPick} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4">
          <label className="relative flex flex-none items-center">
            <MagnifyingGlass size={20} className="pointer-events-none absolute left-4 text-white/60" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Titre, artiste ou album…"
              aria-label="Rechercher une musique"
              enterKeyHint="search"
              className="h-12 w-full rounded-full border-0 bg-white/10 pr-4 pl-12 text-base text-white outline-none placeholder:text-white/50"
            />
          </label>
          <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-6" aria-live="polite">
            {dq.length < 2 && <p className="m-0 px-2 py-3 text-sm text-white/60">Cherche dans la bibliothèque musicale de la bande.</p>}
            {dq.length >= 2 && isFetching && !data && <p className="m-0 px-2 py-3 text-sm text-white/60">Recherche…</p>}
            {error && <p className="m-0 px-2 py-3 text-sm text-white/70">{(error as Error).message}</p>}
            {data?.length === 0 && <p className="m-0 px-2 py-3 text-sm text-white/60">Aucun titre pour « {dq} ».</p>}
            {data?.map((t) => (
              <button key={t.id} type="button" onClick={() => setTrack(t)} className="tap flex items-center gap-3 rounded-[18px] border-0 bg-transparent p-2 text-left text-white hover:bg-white/10">
                <Cover track={t} size={48} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.9375rem] font-bold">{t.title}</span>
                  <span className="block truncate text-[0.8125rem] text-white/65">
                    {t.artist}
                    {t.album ? ` · ${t.album}` : ''}
                  </span>
                </span>
                <span className="flex-none text-xs font-semibold text-white/55 tabular-nums">{clock(t.duration)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
