import type { Post } from '@mandrix/shared';
import { ArrowDown, ArrowUp, ChatCircle, CheckCircle, Heart, Play, Repeat, SpeakerHigh, SpeakerSlash, Sticker } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type TouchEvent, type WheelEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Avatar, EmptyCard, PrimaryBtn, ScreenLoader, cx } from '../components/ui';
import { removeFromPool, toggleLike, toggleRepost, useMe, useReels } from '../lib/data';
import { fmtCount } from '../lib/format';
import { openPool, useUI } from '../lib/store';
import { useViewport } from '../lib/theme';

function Reel({ post, active, muted, onToggleMute }: { post: Post; active: boolean; muted: boolean; onToggleMute: () => void }) {
  const nav = useNavigate();
  const { data: me } = useMe();
  const ref = useRef<HTMLVideoElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active && !paused) v.play().catch(() => setPaused(true));
    else v.pause();
    if (!active) {
      v.currentTime = 0;
      setPaused(false);
    }
  }, [active, paused]);

  const side = 'tap grid h-[50px] w-[50px] place-items-center rounded-full border-0 bg-white/15 text-white transition-transform duration-200 active:scale-[.88]';
  return (
    <div className="phdark relative grid h-full place-items-center">
      {post.media && (
        <video
          ref={ref}
          src={post.media.url}
          poster={post.media.poster ?? undefined}
          muted={muted}
          loop
          playsInline
          preload={active ? 'auto' : 'metadata'}
          className="absolute inset-0 h-full w-full object-cover"
          onTimeUpdate={(e) => e.currentTarget.duration && setProgress(e.currentTarget.currentTime / e.currentTarget.duration)}
          onClick={() => setPaused(!paused)}
        />
      )}
      {paused && active && (
        <span className="pointer-events-none relative grid h-[68px] w-[68px] place-items-center rounded-full bg-white/90 text-night">
          <Play size={26} weight="fill" />
        </span>
      )}
      <div className="absolute top-3.5 right-[18px] left-[18px] h-1 overflow-hidden rounded-sm bg-white/20">
        <div className="h-full rounded-sm bg-white" style={{ width: `${progress * 100}%` }} />
      </div>
      <button type="button" aria-label={muted ? 'Activer le son' : 'Couper le son'} onClick={onToggleMute} className="tap absolute top-7 right-3.5 grid h-11 w-11 place-items-center rounded-full border-0 bg-white/15 text-white backdrop-blur">
        {muted ? <SpeakerSlash size={20} /> : <SpeakerHigh size={20} />}
      </button>
      <div className="absolute right-[84px] bottom-5 left-[18px] flex flex-col gap-2 text-white [text-shadow:0_1px_10px_rgba(0,0,0,.45)]">
        <button type="button" onClick={() => nav(`/u/${post.author.username}`)} className="tap flex items-center gap-2.5 border-0 bg-transparent p-0 text-left text-white">
          <Avatar user={post.author} size={40} className="[text-shadow:none]" />
          <span className="text-[0.9375rem] font-bold">{post.author.displayName}</span>
        </button>
        {post.text && <div className="text-base leading-[1.4]">{post.text}</div>}
      </div>
      <div className="absolute right-3.5 bottom-5 flex flex-col items-center gap-2.5 text-xs font-bold text-white">
        <button type="button" aria-label="Aimer" className={side} onClick={() => toggleLike(post)}>
          <Heart size={24} weight={post.liked ? 'fill' : 'regular'} className={cx(post.liked && 'animate-pop text-heartlite')} />
        </button>
        <span>{fmtCount(post.likes)}</span>
        <button type="button" aria-label="Commenter" className={side} onClick={() => useUI.setState({ commentsFor: post.id })}>
          <ChatCircle size={24} />
        </button>
        <span>{fmtCount(post.comments)}</span>
        <button type="button" aria-label="Republier" className={cx(side, post.reposted && 'text-ice')} onClick={() => me && toggleRepost(post, me.id)}>
          <Repeat size={24} />
        </button>
        <span>{fmtCount(post.reposts)}</span>
        <button
          type="button"
          aria-label="Envoyer dans le pool"
          onClick={() => (post.pool ? removeFromPool({ postId: post.id }) : openPool({ postId: post.id }))}
          className={cx(side, post.pool ? 'bg-brand text-white' : 'bg-white text-night')}
        >
          {post.pool ? <CheckCircle size={24} weight="fill" /> : <Sticker size={24} />}
        </button>
        <span>Pool</span>
      </div>
    </div>
  );
}

export function Reels() {
  const { isPhone } = useViewport();
  const [params] = useSearchParams();
  const reels = useReels();
  const items = reels.data?.pages.flatMap((p) => p.items) ?? [];
  const [idx, setIdx] = useState(0);
  const [muted, setMuted] = useState(true);
  const lock = useRef(false);
  const touchY = useRef(0);
  const wanted = params.get('v');

  useEffect(() => {
    if (!wanted || items.length === 0) return;
    const i = items.findIndex((p) => p.id === wanted);
    if (i >= 0) setIdx(i);
  }, [wanted, items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (idx >= items.length - 2 && reels.hasNextPage && !reels.isFetchingNextPage) reels.fetchNextPage();
  }, [idx, items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = (d: number) => setIdx((i) => Math.max(0, Math.min(items.length - 1, i + d)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'ArrowDown') step(1);
      if (e.key === 'ArrowUp') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (reels.isLoading) return <ScreenLoader />;
  if (items.length === 0)
    return (
      <EmptyCard icon={<Play size={30} weight="fill" />} title="Pas encore de Reels" text="Les vidéos publiées par tes amis apparaîtront ici. Lance-toi avec la première !">
        <PrimaryBtn onClick={() => useUI.getState().openComposer('post', 1)}>Publier une vidéo</PrimaryBtn>
      </EmptyCard>
    );

  const onWheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaY) < 24 || lock.current) return;
    lock.current = true;
    setTimeout(() => (lock.current = false), 650);
    step(e.deltaY > 0 ? 1 : -1);
  };
  const onTouchEnd = (e: TouchEvent) => {
    const d = touchY.current - e.changedTouches[0].clientY;
    if (Math.abs(d) > 50) step(d > 0 ? 1 : -1);
  };

  const nav = 'tap grid h-12 w-12 place-items-center rounded-full border-0 shadow-pill transition-[opacity,transform] duration-300 active:scale-90';
  return (
    <div className="flex animate-in justify-center gap-3.5">
      <div
        onWheel={onWheel}
        onTouchStart={(e) => (touchY.current = e.touches[0].clientY)}
        onTouchEnd={onTouchEnd}
        className="relative w-full max-w-[440px] touch-none overflow-hidden rounded-[36px] bg-night shadow-deep"
        style={{ height: isPhone ? 'calc(100dvh - 210px)' : 'min(74vh, 760px)' }}
      >
        <div className="h-full transition-transform duration-[600ms] ease-[cubic-bezier(.3,.9,.2,1)]" style={{ transform: `translateY(-${idx * 100}%)` }}>
          {items.map((p, i) => (
            <div key={p.id} className="h-full">
              {Math.abs(i - idx) <= 1 ? <Reel post={p} active={i === idx} muted={muted} onToggleMute={() => setMuted(!muted)} /> : <div className="phdark h-full" />}
            </div>
          ))}
        </div>
      </div>
      {!isPhone && (
        <div className="flex flex-col justify-center gap-2.5">
          <button type="button" aria-label="Vidéo précédente" onClick={() => step(-1)} className={cx(nav, 'bg-card text-ink')} style={{ opacity: idx === 0 ? 0.4 : 1 }}>
            <ArrowUp size={20} />
          </button>
          <button type="button" aria-label="Vidéo suivante" onClick={() => step(1)} className={cx(nav, 'bg-ink text-inv')} style={{ opacity: idx >= items.length - 1 ? 0.4 : 1 }}>
            <ArrowDown size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
