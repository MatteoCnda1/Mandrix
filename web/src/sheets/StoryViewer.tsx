import { PaperPlaneRight, Trash, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { Avatar, MediaView, confirmAction } from '../components/ui';
import { api, errMsg } from '../lib/api';
import { qc, useMe, useStories } from '../lib/data';
import { timeAgo } from '../lib/format';
import { toast, useUI } from '../lib/store';

const IMAGE_MS = 4500;

export function StoryViewer({ start }: { start: { group: number; index: number } }) {
  const { data: groups } = useStories();
  const { data: me } = useMe();
  const [pos, setPos] = useState(start);
  const [reply, setReply] = useState('');
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
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
    if (!story || story.media.kind === 'video' || paused) return;
    let last = performance.now();
    const t = setInterval(() => {
      const now = performance.now();
      // Écart plafonné : une app restée en arrière-plan ne saute pas plusieurs stories au retour.
      elapsed.current += Math.min(250, Math.max(0, now - last));
      last = now;
      const p = elapsed.current / IMAGE_MS;
      if (p >= 1) {
        clearInterval(t);
        nextRef.current();
      } else setProgress(p);
    }, 40);
    return () => clearInterval(t);
  }, [story?.id, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  // Gestes : tap gauche/droite, maintenir pour mettre en pause, glisser vers le bas pour fermer,
  // glisser à gauche/droite pour changer d'ami.
  const gesture = useRef<{ x: number; y: number; held: boolean; hold: ReturnType<typeof setTimeout> } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const g = { x: e.clientX, y: e.clientY, held: false, hold: undefined as unknown as ReturnType<typeof setTimeout> };
    g.hold = setTimeout(() => {
      g.held = true;
      setPaused(true);
    }, 220);
    gesture.current = g;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const x = e.clientX - g.x;
    const y = e.clientY - g.y;
    if (Math.abs(x) > 8 || Math.abs(y) > 8) clearTimeout(g.hold);
    setDrag({ x, y });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    setDrag(null);
    if (!g) return;
    clearTimeout(g.hold);
    const x = e.clientX - g.x;
    const y = e.clientY - g.y;
    if (g.held) setPaused(false);
    if (y > 90 && y > Math.abs(x)) return close();
    if (Math.abs(x) > 70 && Math.abs(x) > Math.abs(y)) return void (x < 0 ? nextGroup() : prevGroup());
    if (!g.held && Math.abs(x) < 10 && Math.abs(y) < 10) {
      const r = e.currentTarget.getBoundingClientRect();
      if (e.clientX - r.left < r.width * 0.35) prev();
      else next();
    }
  };

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (paused) v.pause();
    else v.play().catch(() => {});
  }, [paused, story?.id]);

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

  if (!group || !story) return null;

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
        style={
          drag
            ? {
                transform: drag.y > 0 && drag.y > Math.abs(drag.x) ? `translateY(${drag.y}px) scale(${1 - Math.min(drag.y, 400) / 2000})` : `translateX(${drag.x * 0.4}px)`,
                transition: 'none',
              }
            : { transition: 'transform .25s cubic-bezier(.2,.9,.2,1)' }
        }
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
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
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
          {mine && (
            <button type="button" aria-label="Supprimer la story" onClick={remove} className="tap ml-auto grid h-11 w-11 place-items-center rounded-full border-0 bg-white/15 text-white">
              <Trash size={20} />
            </button>
          )}
          <button type="button" aria-label="Fermer" onClick={close} className={`tap grid h-11 w-11 place-items-center rounded-full border-0 bg-white/15 text-white ${mine ? '' : 'ml-auto'}`}>
            <X size={20} />
          </button>
        </div>
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
      <VideoProgress videoRef={videoRef} active={story.media.kind === 'video'} onProgress={setProgress} onEnd={next} storyId={story.id} />
    </div>
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
