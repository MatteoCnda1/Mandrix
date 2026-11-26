import type { StoryView } from '@mandrix/shared';
import { CheckCircle, Eye, MusicNotes, PaperPlaneRight, SpeakerHigh, SpeakerSlash, Sticker, Trash, X } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Avatar, MediaView, Sheet, confirmAction } from '../components/ui';
import { api, errMsg } from '../lib/api';
import { qc, removeFromPool, useMe, useStories } from '../lib/data';
import { timeAgo } from '../lib/format';
import { useMediaGestures } from '../lib/gestures';
import { useScrollLock } from '../lib/scrollLock';
import { openPool, toast, useUI } from '../lib/store';

const IMAGE_MS = 4500;
const QUICK = ['😂', '😍', '😮', '🔥', '👏'];

export function StoryViewer({ start }: { start: { group: number; index: number } }) {
  // Liste figée à l'ouverture : une story vue repasse en fin de liste côté serveur, et un
  // rafraîchissement (retour dans l'app, tirer pour rafraîchir) ne doit pas changer de personne en cours de route.
  const { data: live } = useStories();
  const snapshot = useRef(live);
  if (!snapshot.current && live) snapshot.current = live;
  const groups = snapshot.current;
  useScrollLock();
  const { data: me } = useMe();
  const [pos, setPos] = useState(start);
  const [reply, setReply] = useState('');
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [flying, setFlying] = useState<{ id: number; emoji: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Temps déjà écoulé sur la photo en cours (remis à zéro à chaque story, conservé pendant une pause).
  const elapsed = useRef(0);
  const close = () => {
    useUI.setState({ story: null });
    qc.invalidateQueries({ queryKey: ['stories'] });
  };

  const group = groups?.[pos.group];
  const story = group?.stories[pos.index];
  const mine = !!me && group?.user.id === me.id;
  // Feuille « Envoyer dans le pool » ouverte : la story attend.
  const poolOpen = useUI((s) => !!s.poolFor);
  const halted = paused || poolOpen;
  // État « dans le pool » lu en direct (la liste affichée est figée à l'ouverture).
  const pool = live?.flatMap((g) => g.stories).find((s) => s.id === story?.id)?.pool ?? story?.pool ?? null;
  // Musique (#104) : la photo reste affichée le temps de l'extrait, qui joue en même temps.
  const music = story?.media.kind === 'image' ? (story.music ?? null) : null;
  const storyMs = music ? music.duration * 1000 : IMAGE_MS;
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState(false);
  /** Le navigateur a refusé le son sans geste : un bouton propose de l'activer. */
  const [needsTap, setNeedsTap] = useState(false);

  const next = () => {
    if (!groups || !group) return close();
    if (pos.index + 1 < group.stories.length) setPos({ group: pos.group, index: pos.index + 1 });
    else if (pos.group + 1 < groups.length) setPos({ group: pos.group + 1, index: 0 });
    else close();
  };
  const prev = () => {
    if (!groups) return;
    if (pos.index > 0) setPos({ group: pos.group, index: pos.index - 1 });
    else if (pos.group > 0) setPos({ group: pos.group - 1, index: groups[pos.group - 1].stories.length - 1 });
    else {
      // Première story : on la relance depuis le début.
      elapsed.current = 0;
      setProgress(0);
      if (videoRef.current) videoRef.current.currentTime = 0;
    }
  };
  /** Glisser à gauche / à droite : ami suivant ou précédent. */
  const nextGroup = () => (groups && pos.group + 1 < groups.length ? setPos({ group: pos.group + 1, index: 0 }) : close());
  const prevGroup = () => pos.group > 0 && setPos({ group: pos.group - 1, index: 0 });
  const nextRef = useRef(next);
  nextRef.current = next;

  // Nouvelle story : progression à zéro (avant que le minuteur ne reparte), et marquée comme vue.
  useEffect(() => {
    elapsed.current = 0;
    setProgress(0);
    if (story && !mine && !story.seen) api(`/api/stories/${story.id}/seen`, { method: 'POST' }).catch(() => {});
  }, [story?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Avance automatique pour les photos : le temps écoulé est cumulé image par image,
  // donc un passage manuel ou une pause ne décale jamais la story suivante.
  useEffect(() => {
    if (!story || story.media.kind === 'video' || halted) return;
    let last = performance.now();
    const t = setInterval(() => {
      const now = performance.now();
      // Écart plafonné : une app restée en arrière-plan ne saute pas plusieurs stories au retour.
      elapsed.current += Math.min(250, Math.max(0, now - last));
      last = now;
      const p = elapsed.current / storyMs;
      if (p >= 1) {
        clearInterval(t);
        nextRef.current();
      } else setProgress(p);
    }, 40);
    return () => clearInterval(t);
  }, [story?.id, halted]); // eslint-disable-line react-hooks/exhaustive-deps

  // Gestes : tap gauche/droite, maintenir pour mettre en pause, glisser vers le bas pour fermer,
  // glisser à gauche/droite pour changer d'ami.
  const gestures = useMediaGestures({
    onTap: (zone) => (zone === 'left' ? prev() : next()),
    onHold: (on) => setPaused(on),
    onSwipeDown: close,
    onSwipeX: (dir) => (dir === -1 ? nextGroup() : prevGroup()),
  });

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (halted) v.pause();
    else
      v.play().catch(() => {
        // iOS refuse parfois le son sans geste : on relance sans le son plutôt que de rester bloqué.
        v.muted = true;
        v.play().catch(() => {});
      });
  }, [halted, story?.id]);

  // Extrait musical : joue avec la story, s'arrête avec elle (pause, appui long, feuille ouverte).
  useEffect(() => {
    const a = musicRef.current;
    if (!a || !music) return;
    if (halted) return void a.pause();
    a.muted = muted;
    a.play().then(
      () => setNeedsTap(false),
      () => setNeedsTap(true),
    );
  }, [halted, story?.id, muted, !!music]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!group || !story) {
    if (groups) queueMicrotask(close);
    return null;
  }

  /** Réaction rapide : envoyée en message privé avec la story, sans ouvrir le clavier. */
  const quickReact = async (emoji: string) => {
    setFlying({ id: Date.now(), emoji });
    navigator.vibrate?.(10);
    try {
      await api(`/api/messages/to/${group.user.id}`, { body: { text: emoji, storyId: story.id } });
      toast(`${emoji} envoyé à ${group.user.displayName.split(' ')[0]}`);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const sendReply = async () => {
    const text = reply.trim();
    if (!text) return;
    try {
      await api(`/api/messages/to/${group.user.id}`, { body: { text, storyId: story.id } });
      toast(`Réponse envoyée à ${group.user.displayName}`);
      setReply('');
      setPaused(false);
      next();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const remove = async () => {
    setPaused(true);
    if (!(await confirmAction({ title: 'Supprimer cette story ?', confirmLabel: 'Supprimer', destructive: true }))) return setPaused(false);
    await api(`/api/stories/${story.id}`, { method: 'DELETE' }).catch(() => {});
    toast('Story supprimée');
    close();
  };

  return (
    <div
      className="fixed inset-x-0 z-[45] grid animate-fade place-items-center bg-[rgba(8,12,17,.92)] p-3"
      style={{ top: 'var(--vv-top, 0px)', height: 'var(--vvh, 100dvh)' }}
      role="dialog"
      aria-modal="true"
      aria-label={`Story de ${group.user.displayName}`}
    >
      <div
        className="phdark relative grid h-[min(calc(var(--vvh,100dvh)-24px),760px)] w-full max-w-[420px] animate-drop place-items-center overflow-hidden rounded-[36px]"
        style={gestures.style}
      >
        <MediaView
          key={story.id}
          media={story.media}
          fit="contain"
          autoPlay
          loop={false}
          muted={false}
          videoRef={videoRef}
          className="absolute inset-0"
        />
        {music && (
          <>
            <audio key={story.id} ref={musicRef} src={music.clip.url} loop preload="auto" />
            {/* Pastille de la musique : pochette, titre, artiste ; son coupé ou à activer. */}
            <div className="absolute top-[84px] left-[18px] z-[1] flex max-w-[calc(100%-36px)] items-center gap-2 rounded-full bg-black/45 py-1 pr-1 pl-1 text-white backdrop-blur">
              {music.cover ? <img src={music.cover.url} alt="" className="h-8 w-8 flex-none rounded-full object-cover motion-safe:animate-[spin_8s_linear_infinite]" /> : <MusicNotes size={18} className="ml-1.5 flex-none" />}
              <span className="min-w-0 truncate text-[0.8125rem] font-bold">
                {music.title} <span className="font-semibold text-white/70">· {music.artist}</span>
              </span>
              <button
                type="button"
                aria-label={needsTap ? 'Activer le son' : muted ? 'Remettre le son' : 'Couper le son'}
                onClick={() => {
                  if (needsTap) {
                    musicRef.current?.play().then(
                      () => setNeedsTap(false),
                      () => {},
                    );
                  } else setMuted(!muted);
                }}
                className="tap grid h-8 w-8 flex-none place-items-center rounded-full border-0 bg-white/15 text-white"
              >
                {needsTap || muted ? <SpeakerSlash size={15} weight="bold" /> : <SpeakerHigh size={15} weight="bold" />}
              </button>
            </div>
          </>
        )}
        <div className="absolute top-3.5 right-[18px] left-[18px] flex gap-1">
          {group.stories.map((s, i) => (
            <div key={s.id} className="h-1 flex-1 overflow-hidden rounded-sm bg-white/20">
              <div
                className="h-full rounded-sm bg-white"
                style={{ width: i < pos.index ? '100%' : i > pos.index ? '0%' : `${progress * 100}%` }}
              />
            </div>
          ))}
        </div>
        <div
          className="absolute inset-x-0 top-[90px] bottom-[90px] cursor-pointer touch-none select-none [-webkit-touch-callout:none]"
          {...gestures.handlers}
          aria-hidden
        />
        {/* Clavier et lecteur d'écran. */}
        <button type="button" onClick={prev} className="sr-only">
          Story précédente
        </button>
        <button type="button" onClick={next} className="sr-only">
          Story suivante
        </button>
        <div className="absolute top-[30px] right-3.5 left-[18px] flex items-center gap-2.5 text-white">
          <Avatar user={group.user} size={40} />
          <span className="text-[0.9375rem] font-bold [text-shadow:0_1px_8px_rgba(0,0,0,.4)]">{mine ? 'Ta story' : group.user.displayName}</span>
          <span className="text-[0.8125rem] text-fog">{timeAgo(story.createdAt)}</span>
          <button
            type="button"
            aria-label={pool ? 'Retirer la story du pool' : 'Envoyer la story dans le pool'}
            aria-pressed={!!pool}
            onClick={() => (pool ? void removeFromPool({ storyId: story.id }) : openPool({ storyId: story.id }))}
            className={`tap ml-auto grid h-11 w-11 place-items-center rounded-full border-0 text-white ${pool ? 'bg-brand' : 'bg-white/15'}`}
          >
            {pool ? <CheckCircle size={20} weight="fill" /> : <Sticker size={20} />}
          </button>
          {mine && (
            <button type="button" aria-label="Supprimer la story" onClick={remove} className="tap grid h-11 w-11 place-items-center rounded-full border-0 bg-white/15 text-white">
              <Trash size={20} />
            </button>
          )}
          <button type="button" aria-label="Fermer" onClick={close} className="tap grid h-11 w-11 place-items-center rounded-full border-0 bg-white/15 text-white">
            <X size={20} />
          </button>
        </div>
        {mine && story.views !== null && (
          <button
            type="button"
            onClick={() => {
              setPaused(true);
              setViewersOpen(true);
            }}
            className="tap absolute bottom-4 left-1/2 flex h-11 -translate-x-1/2 items-center gap-2 rounded-full border-0 bg-white/15 px-4 text-sm font-bold text-white backdrop-blur"
          >
            <Eye size={18} /> {story.views} vue{story.views > 1 ? 's' : ''}
          </button>
        )}
        {!mine && !reply && (
          <div className="absolute right-3.5 bottom-[76px] left-3.5 flex justify-center gap-1.5" role="group" aria-label="Réactions rapides">
            {QUICK.map((e) => (
              <button
                key={e}
                type="button"
                aria-label={`Réagir ${e}`}
                onClick={() => void quickReact(e)}
                className="tap grid h-11 w-11 place-items-center rounded-full border-0 bg-white/15 text-[24px] leading-none backdrop-blur transition-transform active:scale-125"
              >
                {e}
              </button>
            ))}
          </div>
        )}
        {flying && (
          <span key={flying.id} aria-hidden className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 animate-burst text-[72px] leading-none" onAnimationEnd={() => setFlying(null)}>
            {flying.emoji}
          </span>
        )}
        {!mine && (
          <form
            className="absolute right-3.5 bottom-4 left-3.5 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              sendReply();
            }}
          >
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onFocus={() => setPaused(true)}
              onBlur={() => !reply && setPaused(false)}
              placeholder={`Répondre à ${group.user.displayName}…`}
              className="h-12 min-w-0 flex-1 rounded-3xl border-0 bg-white/15 px-[18px] text-base text-white outline-none placeholder:text-white/70"
            />
            <button type="submit" aria-label="Envoyer" className="tap grid h-12 w-12 flex-none place-items-center rounded-full border-0 bg-white text-night">
              <PaperPlaneRight size={20} weight="fill" />
            </button>
          </form>
        )}
      </div>
      {viewersOpen && (
        <ViewersSheet
          storyId={story.id}
          onClose={() => {
            setViewersOpen(false);
            setPaused(false);
          }}
        />
      )}
      <VideoProgress videoRef={videoRef} active={story.media.kind === 'video'} onProgress={setProgress} onEnd={next} storyId={story.id} />
    </div>
  );
}

/** Qui a vu ma story. */
function ViewersSheet({ storyId, onClose }: { storyId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['story-viewers', storyId], queryFn: () => api<StoryView[]>(`/api/stories/${storyId}/viewers`) });
  return (
    <Sheet title={`Vue par ${data?.length ?? '…'}`} onClose={onClose}>
      <div className="flex flex-col gap-0.5">
        {isLoading && <div className="py-6 text-center text-sm text-mute">Chargement…</div>}
        {data?.length === 0 && <div className="py-6 text-center text-sm text-mute">Personne ne l’a encore vue.</div>}
        {data?.map((v) => (
          <div key={v.user.id} className="flex items-center gap-3 rounded-3xl p-2">
            <Avatar user={v.user} size={44} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.9375rem] font-bold">{v.user.displayName}</span>
              <span className="block text-[0.8125rem] text-mute">{timeAgo(v.at)}</span>
            </span>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/** Suit la lecture d'une story vidéo pour la barre de progression. */
function VideoProgress({ videoRef, active, onProgress, onEnd, storyId }: { videoRef: React.RefObject<HTMLVideoElement | null>; active: boolean; onProgress: (p: number) => void; onEnd: () => void; storyId: string }) {
  const end = useRef(onEnd);
  end.current = onEnd;
  useEffect(() => {
    const v = videoRef.current;
    if (!active || !v) return;
    const tick = () => v.duration && onProgress(v.currentTime / v.duration);
    const done = () => end.current();
    v.addEventListener('timeupdate', tick);
    v.addEventListener('ended', done);
    return () => {
      v.removeEventListener('timeupdate', tick);
      v.removeEventListener('ended', done);
    };
  }, [active, storyId]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
