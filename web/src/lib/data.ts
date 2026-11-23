import type {
  AppConfig,
  AppNotification,
  Badges,
  Comment,
  Conversation,
  FriendsList,
  Me,
  Message,
  Page,
  PelliculeState,
  Poll,
  PoolScope,
  PoolStats,
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
import { toast } from './store';

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

const infinite = <T>(key: unknown[], url: (page: number) => string) => ({
  queryKey: key,
  queryFn: ({ pageParam }: { pageParam: number }) => api<Page<T>>(url(pageParam)),
  initialPageParam: 0,
  getNextPageParam: (last: Page<T>) => last.next ?? undefined,
});

export const useFeed = () => useInfiniteQuery(infinite<Post>(['feed'], (p) => `/api/feed?page=${p}`));
export const useReels = () => useInfiniteQuery(infinite<Post>(['reels'], (p) => `/api/reels?page=${p}`));
export const useStories = () => useQuery({ queryKey: ['stories'], queryFn: () => api<StoryGroup[]>('/api/stories') });
export const usePost = (id: string) => useQuery({ queryKey: ['post', id], queryFn: () => api<Post>(`/api/posts/${id}`) });
export const useComments = (id: string | null) =>
  useQuery({ queryKey: ['comments', id], queryFn: () => api<Comment[]>(`/api/posts/${id}/comments`), enabled: !!id });
export const useMemes = () =>
  useQuery({ queryKey: ['memes'], queryFn: () => api<{ podium: Post[]; items: Post[]; next: number | null }>('/api/memes?page=0') });
export const usePellicule = () => useQuery({ queryKey: ['pellicule'], queryFn: () => api<PelliculeState>('/api/pellicule') });
export const useUnpack = () => useQuery({ queryKey: ['unpack'], queryFn: () => api<UnpackState>('/api/pellicule/unpack') });
export const usePoolStats = () => useQuery({ queryKey: ['pool-stats'], queryFn: () => api<PoolStats>('/api/pool/stats') });
export const useProfile = (username: string) =>
  useQuery({ queryKey: ['profile', username], queryFn: () => api<UserProfile>(`/api/users/${encodeURIComponent(username)}`), enabled: !!username });
export const useUserPosts = (username: string, tab: 'posts' | 'reels' | 'memes') =>
  useQuery({
    queryKey: ['user-posts', username, tab],
    queryFn: () => api<{ items: Post[]; next: number | null; locked: boolean }>(`/api/users/${encodeURIComponent(username)}/posts?tab=${tab}`),
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
  useQuery({ queryKey: ['conversation', id], queryFn: () => api<{ id: string; user: UserLite }>(`/api/conversations/${id}`) });
export const useMessages = (id: string) =>
  useQuery({ queryKey: ['messages', id], queryFn: () => api<Message[]>(`/api/conversations/${id}/messages`) });
export const useNotifications = (enabled = true) =>
  useQuery({ queryKey: ['notifications'], queryFn: () => api<AppNotification[]>('/api/notifications'), enabled });
export const useBadges = () => useQuery({ queryKey: ['badges'], queryFn: () => api<Badges>('/api/badges'), refetchInterval: 120_000 });
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
  if (post.author.id === myId) {
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

export async function votePoll(post: Post, body: { optionId?: string; value?: number }) {
  if (!post.poll) return;
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

export async function sendToPool(target: { postId?: string; shotId?: string }, scope: PoolScope) {
  try {
    const res = await api<{ pool: PoolScope | null }>('/api/pool', { body: { ...target, scope } });
    if (target.postId) patchPost(target.postId, (p) => ({ ...p, pool: res.pool }));
    if (target.shotId) patchShot(target.shotId, (s) => ({ ...s, pool: res.pool }));
    qc.invalidateQueries({ queryKey: ['pool-stats'] });
    toast(res.pool ? (scope === 'public' ? 'Envoyé dans le pool public' : 'Envoyé dans le pool de tes amis') : 'Contenu en attente de vérification');
    return true;
  } catch (e) {
    toast(errMsg(e), 'error');
    return false;
  }
}

export async function removeFromPool(target: { postId?: string; shotId?: string }) {
  try {
    await api('/api/pool/remove', { body: target });
    if (target.postId) patchPost(target.postId, (p) => ({ ...p, pool: null }));
    if (target.shotId) patchShot(target.shotId, (s) => ({ ...s, pool: null }));
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
    for (const key of [['friends'], ['profile'], ['user-search'], ['feed'], ['stories'], ['user-posts'], ['notifications']]) {
      qc.invalidateQueries({ queryKey: key });
    }
    return res.friendship;
  } catch (e) {
    toast(errMsg(e), 'error');
    return null;
  }
}

export async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  qc.clear();
  qc.setQueryData(['me'], null);
}
