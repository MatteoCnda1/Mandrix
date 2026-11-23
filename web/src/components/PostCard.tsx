import type { Post } from '@mandrix/shared';
import {
  ChatCircle,
  CheckCircle,
  DotsThree,
  Heart,
  Play,
  Repeat,
  Sticker,
  Trash,
  User,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { deletePost, removeFromPool, toggleLike, toggleRepost, useMe, votePoll } from '../lib/data';
import { fmtCount, plural, timeAgo } from '../lib/format';
import { openPool, useUI } from '../lib/store';
import { Avatar, confirmAction, cx, fmtDuration, MediaView, ratioOf, VideoProcessing } from './ui';

const KIND_BADGE: Record<string, string> = { poll: 'Sondage', video: 'Vidéo', meme: 'Mème' };

export function ActionBar({ post }: { post: Post }) {
  const { data: me } = useMe();
  const canPool = !!post.media && post.kind !== 'meme' && post.kind !== 'poll';
  const pill = 'tap flex h-11 items-center gap-1.5 rounded-[22px] border-0 bg-soft px-3.5 text-sm font-semibold text-ink transition-transform duration-200 active:scale-[.92]';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={pill} onClick={() => toggleLike(post)} aria-label={post.liked ? 'Retirer le j’aime' : 'Aimer'} aria-pressed={post.liked}>
        <Heart size={20} weight={post.liked ? 'fill' : 'regular'} className={cx(post.liked && 'animate-pop text-heart')} />
        <span>{fmtCount(post.likes)}</span>
      </button>
      <button type="button" className={pill} onClick={() => useUI.setState({ commentsFor: post.id })} aria-label="Commentaires">
        <ChatCircle size={20} />
        <span>{fmtCount(post.comments)}</span>
      </button>
      <button
        type="button"
        className={cx(pill, post.reposted && 'text-acc')}
        onClick={() => me && toggleRepost(post, me.id)}
        aria-label="Republier"
        aria-pressed={post.reposted}
      >
        <Repeat size={20} />
        <span>{fmtCount(post.reposts)}</span>
      </button>
      {canPool && (
        <button
          type="button"
          onClick={() => (post.pool ? removeFromPool({ postId: post.id }) : openPool({ postId: post.id }))}
          className={cx(
            'tap ml-auto flex h-11 items-center gap-1.5 rounded-[22px] border-0 px-4 text-sm font-bold transition-[background,transform] duration-300 active:scale-[.92]',
            post.pool ? 'bg-brand text-white' : 'bg-ink text-inv',
          )}
        >
          {post.pool ? <CheckCircle size={20} weight="fill" /> : <Sticker size={20} />}
          <span>{post.pool ? 'Dans le pool' : 'Pool'}</span>
        </button>
      )}
    </div>
  );
}

function PollText({ post }: { post: Post }) {
  const poll = post.poll!;
  const voted = !!poll.myVote;
  return (
    <div className="flex flex-col gap-2">
      {poll.options.map((o) => {
        const pct = Math.round((o.votes / (poll.total || 1)) * 100);
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => votePoll(post, { optionId: o.id })}
            className="tap relative flex h-[52px] items-center justify-between overflow-hidden rounded-[26px] border-0 bg-soft px-[18px] text-left text-[15px] font-semibold text-ink transition-[box-shadow,transform] duration-300 active:scale-[.98]"
            style={{ boxShadow: `inset 0 0 0 2px ${poll.myVote === o.id ? '#0E76C6' : 'transparent'}` }}
          >
            <span className="absolute inset-y-0 left-0 rounded-[26px] bg-tint transition-[width] duration-[800ms] ease-out-soft" style={{ width: voted ? `${pct}%` : '0%' }} />
            <span className="relative">{o.label}</span>
            <span className="relative font-extrabold transition-opacity delay-200 duration-[400ms]" style={{ opacity: voted ? 1 : 0 }}>
              {pct} %
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PollImage({ post }: { post: Post }) {
  const poll = post.poll!;
  const voted = !!poll.myVote;
  return (
    <div className="grid grid-cols-2 gap-2">
      {poll.options.map((o, i) => {
        const pct = Math.round((o.votes / (poll.total || 1)) * 100);
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => votePoll(post, { optionId: o.id })}
            className={cx(
              'tap relative grid aspect-square place-items-center overflow-hidden rounded-3xl border-0 p-0 font-mono text-xs text-phink transition-[opacity,box-shadow,transform] duration-[400ms] active:scale-[.97]',
              i ? 'ph2' : 'ph',
            )}
            style={{ opacity: voted && poll.myVote !== o.id ? 0.55 : 1 }}
          >
            {o.media && <MediaView media={o.media} className="absolute inset-0" />}
            <span className="pointer-events-none absolute inset-0 rounded-3xl" style={{ boxShadow: `inset 0 0 0 3px ${poll.myVote === o.id ? '#0E76C6' : 'transparent'}` }} />
            <span className="absolute right-2.5 bottom-2.5 left-2.5 flex h-10 items-center justify-between rounded-[20px] bg-card px-3.5 font-sans text-sm font-bold text-ink">
              <span className="truncate">{o.label}</span>
              <span className="transition-opacity duration-[400ms]" style={{ opacity: voted ? 1 : 0 }}>
                {pct} %
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

const EMOJIS = ['😴', '🥱', '😐', '🙂', '😄', '🔥'];

function PollSlider({ post }: { post: Post }) {
  const poll = post.poll!;
  const [v, setV] = useState(poll.myValue ?? 50);
  const done = poll.myValue !== null;
  const emoji = EMOJIS[Math.min(5, Math.floor((v / 100) * 6))];
  const commit = () => {
    if (poll.myValue !== v) votePoll(post, { value: v });
  };
  return (
    <>
      <div className="relative mx-[22px] h-16">
        <div className="absolute top-[26px] right-[-22px] left-[-22px] h-3 rounded-md bg-soft" />
        <div className="absolute top-[26px] left-[-22px] h-3 rounded-md bg-brand2" style={{ width: `calc(${v}% + 22px)` }} />
        {poll.average !== null && (
          <div
            className="absolute top-[22px] -ml-0.5 h-5 w-1 rounded-sm bg-ink transition-opacity duration-[400ms]"
            style={{ left: `${poll.average}%`, opacity: done ? 1 : 0 }}
          />
        )}
        <div
          className="pointer-events-none absolute top-8 -translate-x-1/2 -translate-y-1/2 leading-none transition-[font-size] duration-150"
          style={{ left: `${v}%`, fontSize: 28 + v * 0.14 }}
        >
          {emoji}
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={v}
          onChange={(e) => setV(+e.target.value)}
          onPointerUp={commit}
          onKeyUp={commit}
          onTouchEnd={commit}
          aria-label={post.text}
          className="absolute top-0 left-[-22px] m-0 h-16 w-[calc(100%+44px)] cursor-pointer opacity-0"
        />
      </div>
      <div className="text-[13px] text-mute">
        {done && poll.average !== null ? `Moyenne des amis : ${poll.average} % · ${plural(poll.total, 'réponse', 'réponses')}` : 'Fais glisser pour répondre'}
      </div>
    </>
  );
}

function VideoTeaser({ post }: { post: Post }) {
  const nav = useNavigate();
  const media = post.media!;
  const [dur, setDur] = useState<string | null>(fmtDuration(media.duration));
  if (media.processing) {
    return (
      <div className="overflow-hidden rounded-3xl" style={{ aspectRatio: ratioOf(media, '4 / 5') }}>
        <VideoProcessing />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => nav(`/reels?v=${post.id}`)}
      aria-label="Lire la vidéo"
      className="tap phdark relative grid w-full place-items-center overflow-hidden rounded-3xl border-0 p-0"
      style={{ aspectRatio: ratioOf(post.media, '4 / 5') }}
    >
      {media.poster ? (
        <img src={media.poster} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <video
          src={`${media.url}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-cover"
          onLoadedMetadata={(e) => setDur(fmtDuration(e.currentTarget.duration))}
        />
      )}
      <span className="relative grid h-[68px] w-[68px] place-items-center rounded-full bg-white text-night transition-transform duration-[250ms] ease-spring hover:scale-110">
        <Play size={26} weight="fill" />
      </span>
      {dur && <span className="absolute right-3.5 bottom-3.5 rounded-[14px] bg-white/15 px-3 py-1.5 text-[13px] font-bold text-white backdrop-blur">{dur}</span>}
    </button>
  );
}

function PostMenu({ post, onClose }: { post: Post; onClose: () => void }) {
  const nav = useNavigate();
  const { data: me } = useMe();
  const mine = me && (post.author.id === me.id || me.isAdmin);
  const item = 'tap flex h-12 w-full items-center gap-2.5 rounded-[20px] border-0 bg-transparent px-3 text-left text-[15px] font-semibold text-ink hover:bg-soft';
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div className="absolute top-12 right-0 z-30 flex w-56 origin-top-right animate-drop flex-col gap-0.5 rounded-[24px] bg-card p-1.5 shadow-menu">
        <button type="button" className={item} onClick={() => nav(`/u/${post.author.username}`)}>
          <User size={20} /> Voir le profil
        </button>
        {mine && (
          <button
            type="button"
            className={cx(item, 'text-heart')}
            onClick={async () => {
              onClose();
              if (await confirmAction({ title: 'Supprimer ce post ?', message: 'Il disparaîtra du fil de tes amis.', confirmLabel: 'Supprimer le post', destructive: true })) deletePost(post);
            }}
          >
            <Trash size={20} /> Supprimer
          </button>
        )}
      </div>
    </>
  );
}

export function PostCard({ post, delay = 0 }: { post: Post; delay?: number }) {
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);
  const isPoll = post.kind === 'poll';
  const small = isPoll;
  return (
    <article className="card flex animate-in flex-col gap-3 p-3.5" style={{ animationDelay: `${Math.min(delay, 0.3)}s`, padding: isPoll ? 16 : 14 }}>
      {post.repostedBy && (
        <div className="-mb-1 flex items-center gap-1.5 px-1 text-[13px] font-semibold text-mute">
          <Repeat size={16} /> {post.repostedBy.displayName} a republié
        </div>
      )}
      <div className="relative flex items-center gap-2.5">
        <button type="button" className="tap flex min-w-0 items-center gap-2.5 border-0 bg-transparent p-0 text-left text-ink" onClick={() => nav(`/u/${post.author.username}`)}>
          <Avatar user={post.author} size={small ? 36 : 44} />
          <div className="min-w-0">
            <div className={cx('truncate font-bold', small ? 'text-sm' : 'text-[15px]')}>{post.author.displayName}</div>
            {!small && (
              <div className="truncate text-[13px] text-mute">
                {timeAgo(post.createdAt)}
                {post.location ? ` · ${post.location}` : ''}
              </div>
            )}
          </div>
        </button>
        <div className="ml-auto flex items-center gap-2">
          {KIND_BADGE[post.kind] && <span className="rounded-[14px] bg-soft px-3 py-1.5 text-xs font-bold">{KIND_BADGE[post.kind]}</span>}
          <button
            type="button"
            aria-label="Options"
            onClick={() => setMenu(true)}
            className="tap grid h-11 w-11 place-items-center rounded-full border-0 bg-soft text-ink"
          >
            <DotsThree size={22} />
          </button>
        </div>
        {menu && <PostMenu post={post} onClose={() => setMenu(false)} />}
      </div>

      {post.kind === 'meme' && <div className="px-2.5 py-1 text-center text-xl leading-tight font-extrabold tracking-[-.02em] text-balance">{post.text}</div>}

      {post.kind === 'photo' && post.media && (
        <div className="ph overflow-hidden rounded-3xl" style={{ aspectRatio: ratioOf(post.media) }}>
          <MediaView media={post.media} />
        </div>
      )}
      {post.kind === 'meme' && post.media && (
        <div className="ph overflow-hidden rounded-3xl" style={{ aspectRatio: ratioOf(post.media, '4 / 3') }}>
          <MediaView media={post.media} autoPlay={post.media.kind === 'video'} />
        </div>
      )}
      {post.kind === 'video' && post.media && <VideoTeaser post={post} />}

      {isPoll && post.poll && (
        <>
          <div className="text-xl leading-tight font-extrabold tracking-[-.02em]">{post.text}</div>
          {post.poll.kind === 'text' && <PollText post={post} />}
          {post.poll.kind === 'image' && <PollImage post={post} />}
          {post.poll.kind === 'slider' && <PollSlider post={post} />}
          {post.poll.kind !== 'slider' && <div className="text-[13px] text-mute">{plural(post.poll.total, 'vote', 'votes')}</div>}
        </>
      )}

      {post.kind !== 'meme' && post.kind !== 'poll' && post.text && <p className="m-0 mx-1 text-base leading-[1.45] whitespace-pre-line">{post.text}</p>}

      {!isPoll ? <ActionBar post={post} /> : <PollFooter post={post} />}
    </article>
  );
}

function PollFooter({ post }: { post: Post }) {
  return (
    <div className="flex items-center gap-3 text-[13px] text-mute">
      <span>{timeAgo(post.createdAt)}</span>
      <button type="button" className="tap ml-auto flex items-center gap-1.5 border-0 bg-transparent p-0 font-semibold text-mute" onClick={() => toggleLike(post)}>
        <Heart size={18} weight={post.liked ? 'fill' : 'regular'} className={cx(post.liked && 'text-heart')} /> {fmtCount(post.likes)}
      </button>
      <button type="button" className="tap flex items-center gap-1.5 border-0 bg-transparent p-0 font-semibold text-mute" onClick={() => useUI.setState({ commentsFor: post.id })}>
        <ChatCircle size={18} /> {fmtCount(post.comments)}
      </button>
    </div>
  );
}
