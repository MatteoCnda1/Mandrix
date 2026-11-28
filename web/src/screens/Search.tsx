import type { FriendSuggestion, PostSearch } from '@mandrix/shared';
import { Hash, MagnifyingGlass, UserPlus, X } from '@phosphor-icons/react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { PostCard } from '../components/PostCard';
import { Avatar, cx, EmptyCard, ErrorCard } from '../components/ui';
import { api } from '../lib/api';
import { friendAction } from '../lib/data';
import { useDebounced, useSentinel } from '../lib/hooks';
import { toast } from '../lib/store';

export const useSuggestions = (enabled = true) =>
  useQuery({ queryKey: ['suggestions'], queryFn: () => api<FriendSuggestion[]>('/api/friends/suggestions'), enabled, staleTime: 5 * 60_000 });

/** « Tu les connais peut-être ? » : amis de tes amis, avec le nombre d'amis en commun. */
export function Suggestions({ limit = 12, onOpen }: { limit?: number; onOpen?: () => void }) {
  const nav = useNavigate();
  const { data } = useSuggestions();
  const [sent, setSent] = useState<Set<string>>(new Set());
  const list = (data ?? []).slice(0, limit);
  if (list.length === 0) return null;
  return (
    <section className="flex flex-col gap-1" aria-label="Suggestions d’amis">
      <div className="px-2 pt-2 text-[0.8125rem] font-bold tracking-wide text-mute uppercase">Tu les connais peut-être ?</div>
      {list.map((s) => (
        <div key={s.user.id} className="flex items-center gap-3 rounded-3xl p-2 transition-colors hover:bg-soft">
          <button
            type="button"
            className="tap flex min-w-0 flex-1 items-center gap-3 border-0 bg-transparent p-0 text-left text-ink"
            onClick={() => {
              onOpen?.();
              nav(`/u/${s.user.username}`);
            }}
          >
            <Avatar user={s.user} size={44} />
            <span className="min-w-0">
              <span className="block truncate text-[0.9375rem] font-bold">{s.user.displayName}</span>
              <span className="block truncate text-[0.8125rem] text-mute">
                {s.via.length ? `Ami·e de ${s.via.join(' et ')}` : ''}
                {s.mutual > s.via.length ? ` +${s.mutual - s.via.length}` : ''}
              </span>
            </span>
          </button>
          <button
            type="button"
            disabled={sent.has(s.user.id)}
            onClick={async () => {
              const r = await friendAction(s.user.id, 'add');
              if (r) {
                setSent((x) => new Set(x).add(s.user.id));
                toast(r === 'friends' ? `Tu es maintenant ami·e avec ${s.user.displayName}` : 'Demande envoyée');
              }
            }}
            className={cx(
              'tap flex h-11 flex-none items-center gap-1.5 rounded-[22px] border-0 px-3.5 text-[0.8125rem] font-bold transition-transform active:scale-95',
              sent.has(s.user.id) ? 'bg-soft text-mute' : 'bg-brand text-white',
            )}
          >
            {sent.has(s.user.id) ? (
              'Demande envoyée'
            ) : (
              <>
                <UserPlus size={16} weight="bold" /> Ajouter
              </>
            )}
          </button>
        </div>
      ))}
    </section>
  );
}

export function Search() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const dq = useDebounced(q.trim(), 300);
  const active = dq.replace(/^#/, '').length >= 2;

  // L'URL suit la recherche (lien partageable, retour arrière).
  useEffect(() => {
    if ((params.get('q') ?? '') !== dq) setParams(dq ? { q: dq } : {}, { replace: true });
  }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  // Clic sur un autre hashtag pendant qu'on est déjà sur l'écran.
  useEffect(() => {
    const fromUrl = params.get('q') ?? '';
    if (fromUrl !== dq) setQ(fromUrl);
  }, [params.get('q')]); // eslint-disable-line react-hooks/exhaustive-deps

  const res = useInfiniteQuery({
    queryKey: ['search', dq],
    queryFn: ({ pageParam }) => api<PostSearch>(`/api/search?q=${encodeURIComponent(dq)}&page=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.posts.length === 20 ? pages.length : undefined),
    enabled: active,
  });
  const posts = res.data?.pages.flatMap((p) => p.posts) ?? [];
  const users = res.data?.pages[0]?.users ?? [];
  const sentinel = useSentinel(() => res.hasNextPage && !res.isFetchingNextPage && res.fetchNextPage(), !!res.hasNextPage);
  const hashtag = dq.startsWith('#');

  return (
    <div data-screen-label="Recherche" className="flex animate-in flex-col gap-3.5">
      <label className="relative flex items-center">
        {hashtag ? <Hash size={20} className="pointer-events-none absolute left-4 text-acc" /> : <MagnifyingGlass size={20} className="pointer-events-none absolute left-4 text-mute" />}
        <input
          className="field w-full pr-12 pl-12"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Posts, sondages, #hashtags, amis…"
          enterKeyHint="search"
          autoFocus={!params.get('q')}
          aria-label="Rechercher"
        />
        {q && (
          <button type="button" aria-label="Effacer" onClick={() => setQ('')} className="tap absolute right-0.5 grid h-11 w-11 place-items-center rounded-full border-0 bg-transparent text-mute">
            <X size={18} />
          </button>
        )}
      </label>

      {!active ? (
        <div className="card flex flex-col p-2">
          <p className="m-0 px-2 py-2 text-[0.9375rem] text-mute">Cherche dans les légendes, les sondages et les mèmes de ton cercle, ou tape # pour un hashtag.</p>
          <Suggestions />
        </div>
      ) : (
        <>
          {users.length > 0 && (
            <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Personnes">
              {users.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => nav(`/u/${u.username}`)}
                  className="tap card flex w-[104px] flex-none flex-col items-center gap-1.5 border-0 p-3 text-center text-ink"
                >
                  <Avatar user={u} size={52} />
                  <span className="w-full truncate text-[0.8125rem] font-bold">{u.displayName}</span>
                  <span className="w-full truncate text-xs text-mute">@{u.username}</span>
                </button>
              ))}
            </div>
          )}
          {res.isLoading && <div className="py-8 text-center text-sm text-mute">Recherche…</div>}
          {res.isError && !res.data && <ErrorCard onRetry={() => void res.refetch()} />}
          {!res.isLoading && !res.isError && posts.length === 0 && users.length === 0 && (
            <EmptyCard
              icon={hashtag ? <Hash size={30} weight="bold" /> : <MagnifyingGlass size={30} weight="bold" />}
              title="Rien trouvé"
              text={hashtag ? `Personne n’a encore utilisé ${dq} dans ton cercle.` : `Aucun post ne contient « ${dq} ».`}
            />
          )}
          {posts.length > 0 && (
            <div className="px-1 text-[0.8125rem] font-bold tracking-wide text-mute uppercase">
              {hashtag ? dq : 'Posts'} · {posts.length}
              {res.hasNextPage ? '+' : ''}
            </div>
          )}
          {posts.map((p, i) => (
            <PostCard key={p.id} post={p} delay={i * 0.04} />
          ))}
          <div ref={sentinel} />
        </>
      )}
    </div>
  );
}
