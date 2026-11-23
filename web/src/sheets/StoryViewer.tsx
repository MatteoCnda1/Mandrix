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
  const videoRef = useRef<HTMLVideoElement | null>(null);
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
  };

  // Marque la story comme vue.
  useEffect(() => {
    setProgress(0);
    if (story && !mine && !story.seen) api(`/api/stories/${story.id}/seen`, { method: 'POST' }).catch(() => {});
  }, [story?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Avance automatique pour les photos.
  useEffect(() => {
    if (!story || story.media.kind === 'video' || paused) return;
    const startAt = Date.now() - progress * IMAGE_MS;
    const t = setInterval(() => {
      const p = (Date.now() - startAt) / IMAGE_MS;
      if (p >= 1) {
        clearInterval(t);
        next();
      } else setProgress(p);
    }, 50);
    return () => clearInterval(t);
  }, [story?.id, paused]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <div className="phdark relative grid h-[min(calc(var(--vvh,100dvh)-24px),760px)] w-full max-w-[420px] animate-drop place-items-center overflow-hidden rounded-[36px]">
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
        <button type="button" aria-label="Story précédente" onClick={prev} className="absolute top-[90px] bottom-[90px] left-0 w-[35%] cursor-pointer border-0 bg-transparent" />
        <button type="button" aria-label="Story suivante" onClick={next} className="absolute top-[90px] right-0 bottom-[90px] w-[65%] cursor-pointer border-0 bg-transparent" />
        <div className="absolute top-[30px] right-3.5 left-[18px] flex items-center gap-2.5 text-white">
          <Avatar user={group.user} size={40} />
          <span className="text-[15px] font-bold [text-shadow:0_1px_8px_rgba(0,0,0,.4)]">{mine ? 'Ta story' : group.user.displayName}</span>
          <span className="text-[13px] text-fog">{timeAgo(story.createdAt)}</span>
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
