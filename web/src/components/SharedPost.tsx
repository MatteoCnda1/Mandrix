import type { SharedPost } from '@mandrix/shared';
import { ChartBar, Play } from '@phosphor-icons/react';
import { useNavigate } from 'react-router';
import { Avatar, MediaView, cx } from './ui';

/** Post partagé dans une conversation (#73) : aperçu cliquable, ou « plus disponible ». */
export function SharedPostCard({ post, mine }: { post: SharedPost | null; mine: boolean }) {
  const nav = useNavigate();
  if (!post) {
    return (
      <span className={cx('block w-[min(240px,62vw)] rounded-[18px] px-3 py-2.5 text-sm italic', mine ? 'bg-black/15 text-white' : 'bg-card/70 text-mute')}>
        Ce post n’est plus disponible
      </span>
    );
  }
  const media = post.media;
  return (
    <button
      type="button"
      onClick={() => nav(`/p/${post.id}`)}
      aria-label={post.anonymous ? 'Voir le post anonyme' : `Voir le post de ${post.author.displayName}`}
      // Dans ma bulle bleue : un voile sombre (et non clair) garde le texte blanc lisible (6:1 au lieu de 3,7:1).
      className={cx('tap block w-[min(240px,62vw)] overflow-hidden rounded-[18px] border-0 p-0 text-left', mine ? 'bg-black/15 text-white' : 'bg-card text-ink')}
    >
      <span className="flex items-center gap-2 px-2.5 py-2">
        <Avatar user={post.author} size={24} anonymous={post.anonymous} />
        <span className="min-w-0 truncate text-[0.8125rem] font-bold">{post.author.displayName}</span>
      </span>
      {media ? (
        <span className="ph relative block aspect-square overflow-hidden">
          {media.kind === 'video' ? (
            <>
              {media.poster && <img src={media.poster} alt="" className="h-full w-full object-cover" />}
              <span className="absolute inset-0 grid place-items-center">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-black/45 text-white">
                  <Play size={20} weight="fill" />
                </span>
              </span>
            </>
          ) : (
            <MediaView media={media} sizes="240px" />
          )}
        </span>
      ) : (
        post.kind === 'poll' && (
          <span className={cx('mx-2.5 flex items-center gap-1.5 text-xs font-bold', mine ? 'text-white' : 'text-mute')}>
            <ChartBar size={16} weight="bold" /> Sondage
          </span>
        )
      )}
      {post.text && <span className={cx('line-clamp-2 px-2.5 pt-1.5 pb-2 text-[0.875rem] leading-snug', !media && 'font-semibold')}>{post.text}</span>}
      {!post.text && <span className="block h-1.5" />}
    </button>
  );
}
