import type { Poll, PollKind, PoolScope, Post, PostKind } from '@mandrix/shared';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { mediaRef } from './media.js';
import { usersByIds, uuidArray } from './users.js';

interface PostRow extends Record<string, unknown> {
  id: string;
  kind: PostKind;
  pollKind: PollKind | null;
  text: string;
  location: string | null;
  createdAt: Date;
  authorId: string;
  mediaId: string | null;
  mediaKind: string | null;
  mediaW: number | null;
  mediaH: number | null;
  likes: number;
  comments: number;
  reposts: number;
  liked: boolean;
  reposted: boolean;
  pool: PoolScope | null;
  repostedById: string | null;
}

interface SelectOpts {
  where: SQL;
  orderBy?: SQL;
  limit?: number;
  offset?: number;
  /** Cercle du lecteur (lui + ses amis) : active l'affichage « republié par ». */
  circle?: string[];
}

export async function selectPosts(viewerId: string, opts: SelectOpts): Promise<Post[]> {
  const circle = opts.circle ? uuidArray(opts.circle) : null;
  const repostedBy = circle
    ? sql`case when p.author_id = any(${circle}) then null else
        (select r.user_id from reposts r where r.post_id = p.id and r.user_id = any(${circle}) order by r.created_at desc limit 1) end`
    : sql`null::uuid`;
  const sortAt = circle
    ? sql`case when p.author_id = any(${circle}) then p.created_at else
        (select max(r.created_at) from reposts r where r.post_id = p.id and r.user_id = any(${circle})) end`
    : sql`p.created_at`;

  const rows = await db.execute<PostRow>(sql`
    select p.id, p.kind, p.poll_kind as "pollKind", p.text, p.location, p.created_at as "createdAt",
      p.author_id as "authorId", p.media_id as "mediaId",
      m.kind as "mediaKind", m.width as "mediaW", m.height as "mediaH",
      (select count(*)::int from likes l where l.post_id = p.id) as likes,
      (select count(*)::int from comments c where c.post_id = p.id) as comments,
      (select count(*)::int from reposts r where r.post_id = p.id) as reposts,
      exists(select 1 from likes l where l.post_id = p.id and l.user_id = ${viewerId}) as liked,
      exists(select 1 from reposts r where r.post_id = p.id and r.user_id = ${viewerId}) as reposted,
      (select pi.scope from pool_items pi where pi.media_id = p.media_id and pi.status = 'active') as pool,
      ${repostedBy} as "repostedById",
      ${sortAt} as "sortAt"
    from posts p
    left join media m on m.id = p.media_id
    where ${opts.where}
    order by ${opts.orderBy ?? sql`"sortAt" desc`}
    limit ${opts.limit ?? 20} offset ${opts.offset ?? 0}
  `);

  const list = [...rows];
  const usersMap = await usersByIds(list.flatMap((r) => [r.authorId, r.repostedById]));
  const polls = await loadPolls(
    viewerId,
    list.filter((r) => r.kind === 'poll').map((r) => ({ id: r.id, kind: r.pollKind ?? 'text' })),
  );

  return list.map((r) => ({
    id: r.id,
    kind: r.kind,
    author: usersMap.get(r.authorId)!,
    text: r.text,
    media: r.mediaId ? mediaRef({ id: r.mediaId, kind: r.mediaKind ?? 'image', width: r.mediaW, height: r.mediaH }) : null,
    location: r.location,
    createdAt: new Date(r.createdAt).toISOString(),
    likes: r.likes,
    comments: r.comments,
    reposts: r.reposts,
    liked: r.liked,
    reposted: r.reposted,
    pool: r.pool,
    repostedBy: r.repostedById ? (usersMap.get(r.repostedById) ?? null) : null,
    poll: polls.get(r.id) ?? null,
  }));
}

export async function loadPolls(viewerId: string, posts: { id: string; kind: PollKind }[]): Promise<Map<string, Poll>> {
  const map = new Map<string, Poll>();
  if (posts.length === 0) return map;
  const ids = uuidArray(posts.map((p) => p.id));

  const options = await db.execute<{
    id: string;
    postId: string;
    label: string;
    mediaId: string | null;
    mediaKind: string | null;
    mediaW: number | null;
    mediaH: number | null;
    votes: number;
  }>(sql`
    select o.id, o.post_id as "postId", o.label, o.media_id as "mediaId",
      m.kind as "mediaKind", m.width as "mediaW", m.height as "mediaH",
      (select count(*)::int from poll_votes v where v.option_id = o.id) as votes
    from poll_options o left join media m on m.id = o.media_id
    where o.post_id = any(${ids})
    order by o.position`);

  const stats = await db.execute<{ postId: string; total: number; avg: number | null }>(sql`
    select post_id as "postId", count(*)::int as total, avg(value)::float as avg
    from poll_votes where post_id = any(${ids}) group by post_id`);

  const mine = await db.execute<{ postId: string; optionId: string | null; value: number | null }>(sql`
    select post_id as "postId", option_id as "optionId", value
    from poll_votes where user_id = ${viewerId} and post_id = any(${ids})`);

  for (const p of posts) {
    const st = [...stats].find((s) => s.postId === p.id);
    const my = [...mine].find((s) => s.postId === p.id);
    map.set(p.id, {
      kind: p.kind,
      options: [...options]
        .filter((o) => o.postId === p.id)
        .map((o) => ({
          id: o.id,
          label: o.label,
          media: o.mediaId ? mediaRef({ id: o.mediaId, kind: o.mediaKind ?? 'image', width: o.mediaW, height: o.mediaH }) : null,
          votes: o.votes,
        })),
      total: st?.total ?? 0,
      myVote: my?.optionId ?? null,
      myValue: my?.value ?? null,
      average: p.kind === 'slider' && st?.avg != null ? Math.round(st.avg) : null,
    });
  }
  return map;
}

export async function getPost(viewerId: string, postId: string): Promise<Post | null> {
  const [p] = await selectPosts(viewerId, { where: sql`p.id = ${postId}`, limit: 1 });
  return p ?? null;
}
