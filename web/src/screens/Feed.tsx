import type { StoryGroup } from '@mandrix/shared';
import { ArrowRight, ArrowUp, LockSimple, MagnifyingGlass, Plus, UsersThree } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { PostCard } from '../components/PostCard';
import { Avatar, EmptyCard, PrimaryBtn, ScreenLoader, cx, PullIndicator } from '../components/ui';
import { qc, useFeed, useFriends, useMe, usePellicule, useStories } from '../lib/data';
import { useFeedFresh } from '../lib/socket';
import { countdown } from '../lib/format';
import { useNow, usePullToRefresh, useSentinel } from '../lib/hooks';
import { openSheet, useUI } from '../lib/store';
import { useViewport } from '../lib/theme';

/** Image d'aperçu d'une story : la photo, ou la miniature de la vidéo. */
const storyPreview = (g: StoryGroup) => {
  const next = g.stories.find((st) => !st.seen) ?? g.stories[g.stories.length - 1];
  return next.media.kind === 'image' ? next.media.url : next.media.poster;
};

function StoryTile({ group, label, ring, onClick, badge }: { group: StoryGroup; label: string; ring: boolean; onClick: () => void; badge?: React.ReactNode }) {
  const preview = storyPreview(group);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Story de ${group.user.displayName}`}
      className="tap flex w-[76px] flex-none flex-col items-center gap-1.5 border-0 bg-transparent p-0 text-ink transition-transform duration-200 active:scale-[.94]"
    >
      <span className={cx('relative h-[104px] w-[76px] rounded-[26px] p-[3px] transition-colors duration-[400ms]', ring ? 'bg-gradient-to-br from-azure via-brand2 to-ember' : 'bg-line')}>
        <span className="ph relative block h-full w-full overflow-hidden rounded-[23px]">
          {preview ? (
            <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-[0.9375rem] font-extrabold text-phink">{group.user.initials}</span>
          )}
          <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/45 to-transparent" />
          <span className="pointer-events-none absolute inset-0 rounded-[23px] shadow-[inset_0_0_0_2px_var(--card)]" />
          <Avatar user={group.user} size={26} className="absolute top-1.5 left-1.5 shadow-[0_0_0_2px_var(--card)]" />
        </span>
        {badge}
      </span>
      <span className="max-w-full truncate text-xs font-semibold">{label}</span>
    </button>
  );
}

function Stories() {
  const { data: groups } = useStories();
  const { data: me } = useMe();
  const mineIdx = groups?.findIndex((g) => g.user.id === me?.id) ?? -1;
  const mine = mineIdx >= 0 ? groups![mineIdx] : null;
  const addStory = () => useUI.getState().openComposer('story');
  return (
    <div className="no-scrollbar flex gap-2.5 overflow-x-auto px-0.5 pt-1 pb-1.5">
      {mine ? (
        <StoryTile
          group={mine}
          label="Ta story"
          ring={false}
          onClick={() => useUI.setState({ story: { group: mineIdx, index: 0 } })}
          badge={
            <span
              role="button"
              aria-label="Ajouter une story"
              onClick={(e) => {
                e.stopPropagation();
                addStory();
              }}
              className="absolute -right-1.5 -bottom-1.5 grid h-8 w-8 place-items-center rounded-full bg-brand text-white shadow-[0_0_0_3px_var(--card)] after:absolute after:-inset-2 after:content-['']"
            >
              <Plus size={14} weight="bold" />
            </span>
          }
        />
      ) : (
        <button type="button" onClick={addStory} className="tap flex w-[76px] flex-none flex-col items-center gap-1.5 border-0 bg-transparent p-0 text-ink">
          <span className="relative grid h-[104px] w-[76px] place-items-center overflow-hidden rounded-[26px] bg-card shadow-pill">
            {me?.avatarUrl && <img src={me.avatarUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-35" />}
            <span className="relative grid h-9 w-9 place-items-center rounded-full bg-brand text-white">
              <Plus size={18} />
            </span>
          </span>
          <span className="text-xs font-semibold">Ta story</span>
        </button>
      )}
      {groups?.map((g, i) =>
        g.user.id === me?.id ? null : (
          <StoryTile
            key={g.user.id}
            group={g}
            label={g.user.displayName.split(' ')[0]}
            ring={!g.allSeen}
            onClick={() => useUI.setState({ story: { group: i, index: Math.max(0, g.stories.findIndex((st) => !st.seen)) } })}
          />
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
  // Pagination par décalage : un post publié pendant le défilement peut réapparaître sur la page suivante.
  const items = (feed.data?.pages.flatMap((p) => p.items) ?? []).filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i);
  const sentinel = useSentinel(() => feed.hasNextPage && !feed.isFetchingNextPage && feed.fetchNextPage(), !!feed.hasNextPage);
  const { pull, refreshing } = usePullToRefresh(() =>
    Promise.all([feed.refetch(), qc.invalidateQueries({ queryKey: ['stories'] }), qc.invalidateQueries({ queryKey: ['pellicule'] })]),
  );

  // Pastille « Nouveaux posts » : un ami a publié pendant qu'on lisait le fil.
  const { data: me } = useMe();
  const fresh = useFeedFresh();
  const freshFromOthers = fresh.authors.some((a) => a !== me?.id);
  const showFresh = fresh.count > 0 && freshFromOthers;
  useEffect(() => {
    // Retour sur le fil après des publications : on recharge une fois, sans pastille.
    if (useFeedFresh.getState().count > 0) {
      useFeedFresh.setState({ count: 0, authors: [] });
      void feed.refetch();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Déjà tout en haut : on recharge directement, sans pastille.
    if (showFresh && window.scrollY < 80) {
      useFeedFresh.setState({ count: 0, authors: [] });
      void feed.refetch();
    }
  }, [showFresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const people = useFriends().data?.friends ?? [];
  const freshPeople = fresh.authors.map((id) => people.find((u) => u.id === id)).filter((u): u is NonNullable<typeof u> => !!u);
  const showNew = () => {
    useFeedFresh.setState({ count: 0, authors: [] });
    // Retour immédiat en haut : une animation serait décalée par l'arrivée des nouveaux posts.
    window.scrollTo({ top: 0 });
    void feed.refetch();
  };

  if (feed.isLoading) return <ScreenLoader />;

  return (
    <div className="flex flex-col gap-3.5">
      {showFresh && (
        <button
          type="button"
          onClick={showNew}
          className="tap fixed left-1/2 z-30 flex h-11 -translate-x-1/2 animate-pop items-center gap-2 rounded-full border-0 bg-brand pr-4 pl-2 text-sm font-bold text-white shadow-blue"
          style={{ top: 'calc(74px + env(safe-area-inset-top))' }}
        >
          <span className="flex -space-x-2">
            {freshPeople.map((u) => (
              <Avatar key={u.id} user={u} size={28} className="shadow-[0_0_0_2px_var(--color-brand)]" />
            ))}
          </span>
          <ArrowUp size={16} weight="bold" />
          Nouveaux posts
        </button>
      )}
      <PullIndicator pull={pull} refreshing={refreshing} />
      <button
        type="button"
        onClick={() => nav('/recherche')}
        className="tap flex h-12 animate-in items-center gap-2.5 rounded-[24px] border-0 bg-glass px-4 text-left text-[0.9375rem] text-mute shadow-pill backdrop-blur"
      >
        <MagnifyingGlass size={20} />
        Rechercher des posts, #hashtags, amis…
      </button>
      <Stories />
      {!isDesktop && (
        <button
          type="button"
          onClick={() => nav('/pellicule')}
          className="tap flex min-h-[60px] animate-in items-center gap-3 rounded-[30px] border-0 bg-brand py-2 pr-[18px] pl-2 text-left text-[0.9375rem] font-bold text-white shadow-blue transition-transform active:scale-[.98]"
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
