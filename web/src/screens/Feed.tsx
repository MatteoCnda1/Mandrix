import { ArrowClockwise, ArrowRight, LockSimple, Plus, UsersThree } from '@phosphor-icons/react';
import { useNavigate } from 'react-router';
import { PostCard } from '../components/PostCard';
import { Avatar, EmptyCard, PrimaryBtn, ScreenLoader, cx } from '../components/ui';
import { qc, useFeed, useMe, usePellicule, useStories } from '../lib/data';
import { countdown } from '../lib/format';
import { useNow, usePullToRefresh, useSentinel } from '../lib/hooks';
import { openSheet, useUI } from '../lib/store';
import { useViewport } from '../lib/theme';

function Stories() {
  const { data: groups } = useStories();
  const { data: me } = useMe();
  const mineIdx = groups?.findIndex((g) => g.user.id === me?.id) ?? -1;
  return (
    <div className="no-scrollbar flex gap-2.5 overflow-x-auto px-0.5 pt-1 pb-1.5">
      <button
        type="button"
        onClick={() => (mineIdx >= 0 ? useUI.setState({ story: { group: mineIdx, index: 0 } }) : useUI.getState().openComposer('story'))}
        className="tap flex w-[72px] flex-none flex-col items-center gap-1.5 border-0 bg-transparent p-0 text-ink"
      >
        <span className="relative grid h-[92px] w-[68px] place-items-center rounded-3xl bg-card shadow-pill">
          {mineIdx >= 0 && me ? (
            <Avatar user={me} size={48} />
          ) : (
            <span className="grid h-9 w-9 place-items-center rounded-full bg-brand text-white">
              <Plus size={18} />
            </span>
          )}
          {mineIdx >= 0 && (
            <span
              role="button"
              aria-label="Ajouter une story"
              onClick={(e) => {
                e.stopPropagation();
                useUI.getState().openComposer('story');
              }}
              className="absolute -right-1.5 -bottom-1.5 grid h-8 w-8 place-items-center rounded-full bg-brand text-white shadow-[0_0_0_3px_var(--card)] after:absolute after:-inset-2 after:content-['']"
            >
              <Plus size={14} weight="bold" />
            </span>
          )}
        </span>
        <span className="text-xs font-semibold">Ta story</span>
      </button>
      {groups?.map((g, i) =>
        g.user.id === me?.id ? null : (
          <button
            key={g.user.id}
            type="button"
            onClick={() => useUI.setState({ story: { group: i, index: Math.max(0, g.stories.findIndex((s) => !s.seen)) } })}
            className="tap flex w-[72px] flex-none flex-col items-center gap-1.5 border-0 bg-transparent p-0 text-ink transition-transform duration-200 active:scale-[.94]"
          >
            <span className={cx('h-[92px] w-[68px] rounded-3xl p-[3px] transition-colors duration-[400ms]', g.allSeen ? 'bg-line' : 'bg-azure')}>
              <span className="ph relative grid h-full w-full place-items-center overflow-hidden rounded-[21px] text-[15px] font-extrabold text-phink shadow-[inset_0_0_0_2px_var(--card)]">
                {g.stories[g.stories.length - 1].media.kind === 'image' ? (
                  <img src={g.stories[g.stories.length - 1].media.url} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                ) : (
                  g.user.initials
                )}
                <span className="pointer-events-none absolute inset-0 rounded-[21px] shadow-[inset_0_0_0_2px_var(--card)]" />
              </span>
            </span>
            <span className="max-w-full truncate text-xs font-semibold">{g.user.displayName.split(' ')[0]}</span>
          </button>
        ),
      )}
    </div>
  );
}

export function Feed() {
  const nav = useNavigate();
  const { isDesktop } = useViewport();
  const feed = useFeed();
  const { data: pel } = usePellicule();
  const now = useNow(1000);
  const cd = countdown(pel?.nextRevealAt, now);
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];
  const sentinel = useSentinel(() => feed.hasNextPage && !feed.isFetchingNextPage && feed.fetchNextPage(), !!feed.hasNextPage);
  const { pull, refreshing } = usePullToRefresh(() =>
    Promise.all([feed.refetch(), qc.invalidateQueries({ queryKey: ['stories'] }), qc.invalidateQueries({ queryKey: ['pellicule'] })]),
  );

  if (feed.isLoading) return <ScreenLoader />;

  return (
    <div className="flex flex-col gap-3.5">
      <div
        className="-mb-3.5 flex items-end justify-center overflow-hidden"
        style={{ height: pull, transition: pull && !refreshing ? 'none' : 'height .3s cubic-bezier(.2,.9,.2,1)' }}
        aria-hidden={!refreshing}
      >
        <span className="mb-2 grid h-10 w-10 place-items-center rounded-full bg-card text-acc shadow-pill">
          <ArrowClockwise
            size={20}
            weight="bold"
            className={refreshing ? 'animate-spin' : undefined}
            style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)`, opacity: Math.min(1, pull / 60) }}
          />
        </span>
      </div>
      <Stories />
      {!isDesktop && (
        <button
          type="button"
          onClick={() => nav('/pellicule')}
          className="tap flex min-h-[60px] animate-in items-center gap-3 rounded-[30px] border-0 bg-brand py-2 pr-[18px] pl-2 text-left text-[15px] font-bold text-white shadow-blue transition-transform active:scale-[.98]"
        >
          <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-card text-acc">
            <LockSimple size={20} weight="fill" />
          </span>
          <span className="min-w-0 flex-1 tabular-nums">{cd.line}</span>
          <ArrowRight size={20} />
        </button>
      )}
      {items.length === 0 && (
        <EmptyCard icon={<UsersThree size={30} weight="fill" />} title="Ton fil est vide" text="Ajoute des amis pour voir leurs photos, vidéos et sondages — ou publie ton premier post.">
          <div className="flex flex-wrap justify-center gap-2">
            <PrimaryBtn onClick={() => openSheet('friends')}>Trouver des amis</PrimaryBtn>
            <PrimaryBtn tone="soft" onClick={() => useUI.getState().openComposer('post')}>
              Publier un post
            </PrimaryBtn>
          </div>
        </EmptyCard>
      )}
      {items.map((p, i) => (
        <PostCard key={`${p.id}-${p.repostedBy?.id ?? ''}`} post={p} delay={(i % 15) * 0.05} />
      ))}
      <div ref={sentinel} />
      {feed.isFetchingNextPage && <div className="py-4 text-center text-sm font-semibold text-mute">Chargement…</div>}
      {items.length > 0 && !feed.hasNextPage && <div className="py-4 text-center text-sm font-semibold text-mute">Tu es à jour ✨</div>}
    </div>
  );
}
