import type {
  AppConfig,
  AppNotification,
  Badges,
  Comment,
  GuessState,
  RetroState,
  WhoisQuestion,
  Conversation,
  ConversationDetail,
  FriendsList,
  InviteInfo,
  Me,
  MemberCard,
  Message,
  Page,
  PelliculeState,
  Poll,
  PoolScope,
  PoolStats,
  ProfilePosts,
  Post,
  ReportedItem,
  Shot,
  StoryGroup,
  UnpackState,
  UserLite,
  UserProfile,
  UserSearchResult,
} from '@mandrix/shared';
import { QueryClient, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, ApiError, errMsg } from './api';
import { closeSheet, toast, type PoolTarget } from './store';
import { useOutbox } from './outbox';

export const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      retry: (n, err) => !(err instanceof ApiError && err.status > 0 && err.status < 500) && n < 2,
    },
  },
});

// ——— Requêtes ———

export const useConfig = () => useQuery({ queryKey: ['config'], queryFn: () => api<AppConfig>('/api/config'), staleTime: Infinity });

export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api<Me>('/api/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
  });

const infinite = <T>(key: unknown[], url: (page: number | string) => string, initialPageParam: number | string = 0) => ({
  queryKey: key,
  queryFn: ({ pageParam }: { pageParam: number | string }) => api<Page<T>>(url(pageParam)),
  initialPageParam,
  getNextPageParam: (last: Page<T>) => last.next ?? undefined,
});

/** Fil paginé par curseur (le serveur renvoie le curseur de la page suivante). */
export const useFeed = () => useInfiniteQuery(infinite<Post>(['feed'], (c) => (c ? `/api/feed?cursor=${c}` : '/api/feed'), ''));
export const useReels = () => useInfiniteQuery(infinite<Post>(['reels'], (p) => `/api/reels?page=${p}`));
/** Tous les membres (#93), par pages, avec recherche. */
export const useDirectory = (q: string, enabled = true) =>
  useInfiniteQuery({ ...infinite<MemberCard>(['directory', q], (p) => `/api/users/directory?page=${p}${q ? `&q=${encodeURIComponent(q)}` : ''}`), enabled });
export const useStories = () => useQuery({ queryKey: ['stories'], queryFn: () => api<StoryGroup[]>('/api/stories') });
export const usePost = (id: string, enabled = true) =>
  useQuery({ queryKey: ['post', id], queryFn: () => api<Post>(`/api/posts/${id}`), enabled: enabled && !!id });
export const useComments = (id: string | null) =>
  useQuery({ queryKey: ['comments', id], queryFn: () => api<Comment[]>(`/api/posts/${id}/comments`), enabled: !!id });
export const useMemes = () =>
  useQuery({ queryKey: ['memes'], queryFn: () => api<{ podium: Post[]; items: Post[]; next: number | null }>('/api/memes?page=0') });
export const usePellicule = () => useQuery({ queryKey: ['pellicule'], queryFn: () => api<PelliculeState>('/api/pellicule') });
export const useUnpack = () => useQuery({ queryKey: ['unpack'], queryFn: () => api<UnpackState>('/api/pellicule/unpack') });
export const useGuess = (enabled = true) => useQuery({ queryKey: ['guess'], queryFn: () => api<GuessState | null>('/api/pellicule/guess'), enabled });
export const useRetro = (year?: number) =>
  useQuery({ queryKey: ['retro', year ?? 'default'], queryFn: () => api<RetroState>(`/api/retro${year ? `?year=${year}` : ''}`), staleTime: 5 * 60_000 });
export const useWhoisQuestions = () => useQuery({ queryKey: ['whois-questions'], queryFn: () => api<WhoisQuestion[]>('/api/whois/questions') });
export const usePoolStats = () => useQuery({ queryKey: ['pool-stats'], queryFn: () => api<PoolStats>('/api/pool/stats') });
export const useProfile = (username: string) =>
  useQuery({ queryKey: ['profile', username], queryFn: () => api<UserProfile>(`/api/users/${encodeURIComponent(username)}`), enabled: !!username });
export const useUserPosts = (username: string, tab: 'posts' | 'reels' | 'memes') =>
  useQuery({
    queryKey: ['user-posts', username, tab],
    queryFn: () => api<ProfilePosts>(`/api/users/${encodeURIComponent(username)}/posts?tab=${tab}`),
  });
export const useFriends = () => useQuery({ queryKey: ['friends'], queryFn: () => api<FriendsList>('/api/friends') });
export const useUserSearch = (q: string) =>
  useQuery({
    queryKey: ['user-search', q],
    queryFn: () => api<UserSearchResult[]>(`/api/users/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
    staleTime: 10_000,
  });
export const useConversations = () => useQuery({ queryKey: ['conversations'], queryFn: () => api<Conversation[]>('/api/conversations') });
export const useConversation = (id: string) =>
  useQuery({ queryKey: ['conversation', id], queryFn: () => api<ConversationDetail>(`/api/conversations/${id}`) });
export const useMessages = (id: string) =>
  useQuery({
    queryKey: ['messages', id],
    queryFn: async () => {
      const fresh = await api<Message[]>(`/api/conversations/${id}/messages`);
      // Rechargement (retour dans l'app…) : on garde les anciens messages chargés en remontant.
      const old = qc.getQueryData<Message[]>(['messages', id]);
      if (!old?.length || !fresh.length) return fresh;
      const ids = new Set(fresh.map((m) => m.id));
      const older = old.filter((m) => !ids.has(m.id) && m.createdAt < fresh[0].createdAt);
      // Arrivés par le socket (ou la file d'envoi) pendant le rechargement : on ne les perd pas.
      const newer = old.filter((m) => !ids.has(m.id) && m.createdAt > fresh[fresh.length - 1].createdAt);
      return [...older, ...fresh, ...newer];
    },
  });
export const useNotifications = (enabled = true) =>
  useQuery({ queryKey: ['notifications'], queryFn: () => api<AppNotification[]>('/api/notifications'), enabled });
export const useBadges = () => useQuery({ queryKey: ['badges'], queryFn: () => api<Badges>('/api/badges'), refetchInterval: 120_000 });
/** Code de parrainage : seulement pour les membres autorisés à parrainer (sinon 403). */
export const useInvite = (enabled: boolean) =>
  useQuery({ queryKey: ['invite'], queryFn: () => api<InviteInfo>('/api/me/invite'), staleTime: 5 * 60_000, enabled });
export const useReports = (enabled: boolean) =>
  useQuery({ queryKey: ['reports'], queryFn: () => api<ReportedItem[]>('/api/admin/reports'), enabled });

// ——— Mise à jour optimiste partout où un post/une photo apparaît ———

type Pred = (o: Record<string, unknown>) => boolean;

function deepMap(value: unknown, pred: Pred, fn: (o: never) => unknown): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const n = deepMap(v, pred, fn);
      if (n !== v) changed = true;
      return n;
    });
    return changed ? out : value;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (pred(obj)) return fn(obj as never);
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj)) {
      const n = deepMap(obj[k], pred, fn);
      if (n !== obj[k]) changed = true;
      out[k] = n;
    }
    return changed ? out : value;
  }
  return value;
}

function patchAll(pred: Pred, fn: (o: never) => unknown) {
  for (const q of qc.getQueryCache().getAll()) {
    const data = q.state.data;
    if (data === undefined) continue;
    const next = deepMap(data, pred, fn);
    if (next !== data) qc.setQueryData(q.queryKey, next);
  }
}

const isPost = (id: string): Pred => (o) => o.id === id && 'reposted' in o && 'author' in o;
const isShot = (id: string): Pred => (o) => o.id === id && 'takenAt' in o && 'author' in o;

export const patchPost = (id: string, fn: (p: Post) => Post) => patchAll(isPost(id), fn as (o: never) => unknown);
export const patchShot = (id: string, fn: (s: Shot) => Shot) => patchAll(isShot(id), fn as (o: never) => unknown);

async function optimistic(apply: () => void, revert: () => void, call: () => Promise<unknown>) {
  apply();
  try {
    await call();
  } catch (e) {
    revert();
    toast(errMsg(e), 'error');
  }
}

// ——— Actions ———

export function toggleLike(post: Post) {
  const on = !post.liked;
  const set = (liked: boolean) => patchPost(post.id, (p) => ({ ...p, liked, likes: p.likes + (liked ? 1 : -1) }));
  return optimistic(
    () => set(on),
    () => set(!on),
    () => api(`/api/posts/${post.id}/like`, { method: on ? 'PUT' : 'DELETE' }),
  );
}

export function toggleRepost(post: Post, myId: string) {
  if (post.mine || post.author.id === myId) {
    toast('Tu ne peux pas republier ton propre post', 'error');
    return;
  }
  const on = !post.reposted;
  const set = (reposted: boolean) => patchPost(post.id, (p) => ({ ...p, reposted, reposts: p.reposts + (reposted ? 1 : -1) }));
  return optimistic(
    () => set(on),
    () => set(!on),
    async () => {
      await api(`/api/posts/${post.id}/repost`, { method: on ? 'PUT' : 'DELETE' });
      if (on) toast('Republié sur ton fil');
    },
  );
}

/** Réaction emoji sur un post (même emoji : retirée). */
export async function reactToPost(post: Post, emoji: string) {
  const remove = post.myReaction === emoji;
  try {
    const r = await api<Pick<Post, 'reactions' | 'myReaction'>>(`/api/posts/${post.id}/reaction`, remove ? { method: 'DELETE' } : { method: 'PUT', body: { emoji } });
    patchPost(post.id, (p) => ({ ...p, ...r }));
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

export async function votePoll(post: Post, body: { optionId?: string; value?: number }) {
  if (!post.poll) return;
  if (post.poll.closed) return toast('Ce sondage est terminé', 'error');
  const prev = post.poll;
  if (body.optionId) {
    const had = prev.myVote;
    patchPost(post.id, (p) => ({
      ...p,
      poll: {
        ...prev,
        myVote: body.optionId!,
        total: prev.total + (had ? 0 : 1),
        options: prev.options.map((o) => ({
          ...o,
          votes: o.votes + (o.id === body.optionId ? 1 : 0) - (o.id === had ? 1 : 0),
        })),
      },
    }));
  }
  try {
    const poll = await api<Poll>(`/api/posts/${post.id}/vote`, { body });
    patchPost(post.id, (p) => ({ ...p, poll }));
  } catch (e) {
    patchPost(post.id, (p) => ({ ...p, poll: prev }));
    toast(errMsg(e), 'error');
  }
}

/** Met à jour l'état « dans le pool » d'une story dans le cache (la visionneuse le lit en direct). */
function patchStory(storyId: string, pool: PoolScope | null) {
  qc.setQueryData<StoryGroup[]>(['stories'], (groups) =>
    groups?.map((g) => ({ ...g, stories: g.stories.map((s) => (s.id === storyId ? { ...s, pool } : s)) })),
  );
}

export async function sendToPool(target: PoolTarget, scope: PoolScope) {
  try {
    const res = await api<{ pool: PoolScope | null }>('/api/pool', { body: { ...target, scope } });
    if (target.postId) patchPost(target.postId, (p) => ({ ...p, pool: res.pool }));
    if (target.shotId) patchShot(target.shotId, (s) => ({ ...s, pool: res.pool }));
    if (target.storyId) patchStory(target.storyId, res.pool);
    qc.invalidateQueries({ queryKey: ['pool-stats'] });
    toast(res.pool ? (scope === 'public' ? 'Envoyé dans le pool public' : 'Envoyé dans le pool de tes amis') : 'Contenu en attente de vérification');
    return true;
  } catch (e) {
    toast(errMsg(e), 'error');
    return false;
  }
}

export async function removeFromPool(target: PoolTarget) {
  try {
    await api('/api/pool/remove', { body: target });
    if (target.postId) patchPost(target.postId, (p) => ({ ...p, pool: null }));
    if (target.shotId) patchShot(target.shotId, (s) => ({ ...s, pool: null }));
    if (target.storyId) patchStory(target.storyId, null);
    qc.invalidateQueries({ queryKey: ['pool-stats'] });
    toast('Retiré du pool');
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

export function toggleShotLike(shot: Shot) {
  const on = !shot.liked;
  const set = (liked: boolean) => patchShot(shot.id, (s) => ({ ...s, liked, likes: s.likes + (liked ? 1 : -1) }));
  return optimistic(
    () => set(on),
    () => set(!on),
    () => api(`/api/pellicule/shots/${shot.id}/like`, { method: on ? 'PUT' : 'DELETE' }),
  );
}

export async function deletePost(post: Post) {
  try {
    await api(`/api/posts/${post.id}`, { method: 'DELETE' });
    for (const key of [['feed'], ['reels'], ['memes'], ['user-posts']]) qc.invalidateQueries({ queryKey: key });
    toast('Post supprimé');
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

export async function friendAction(userId: string, action: 'add' | 'remove') {
  try {
    const res = await api<{ friendship: string }>(`/api/friends/${userId}`, { method: action === 'add' ? 'POST' : 'DELETE' });
    for (const key of [['friends'], ['profile'], ['user-search'], ['directory'], ['feed'], ['stories'], ['user-posts'], ['notifications']]) {
      qc.invalidateQueries({ queryKey: key });
    }
    return res.friendship;
  } catch (e) {
    toast(errMsg(e), 'error');
    return null;
  }
}

/** Ouvre (ou crée) la conversation à deux avec un ami. */
export async function openConversation(userId: string, nav: (to: string) => void) {
  try {
    const { id } = await api<{ id: string }>('/api/conversations', { body: { userId } });
    closeSheet();
    nav(`/messages/${id}`);
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

/** Épingle un de mes posts en tête de mon profil (#81), ou le désépingle (null). */
export async function pinPost(postId: string | null) {
  try {
    await api('/api/me/pinned-post', { method: 'PUT', body: { postId } });
    qc.setQueryData<Me | null>(['me'], (m) => (m ? { ...m, pinnedPostId: postId } : m));
    for (const k of [['user-posts'], ['profile']]) qc.invalidateQueries({ queryKey: k });
    toast(postId ? 'Post épinglé sur ton profil' : 'Post désépinglé');
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

export async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  // Rien de l'ancien compte ne doit partir depuis le suivant : file d'envoi et brouillons effacés.
  try {
    for (const k of ['mandrix.outbox', 'mandrix.draft.post', 'mandrix.draft.poll']) localStorage.removeItem(k);
  } catch {
    /* stockage indisponible */
  }
  // Et en mémoire : sinon la file serait réécrite au prochain changement, au nom du compte suivant.
  useOutbox.setState({ items: [] });
  await import('./persist').then((m) => m.forgetCache()).catch(() => {});
  qc.clear();
  qc.setQueryData(['me'], null);
}
