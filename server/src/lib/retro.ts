import type { RetroState } from '@mandrix/shared';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { mediaRef } from './media.js';
import { selectPosts } from './posts.js';
import { friendIds, usersByIds } from './users.js';

// Rétro de l'année d'une personne : tout est calculé à la demande, sur l'année civile à Paris.

const WEEK_MS = 7 * 86400_000;

/** Série la plus longue de semaines consécutives avec au moins une photo. */
export function longestStreak(reveals: Date[]): number {
  const times = [...new Set(reveals.map((d) => d.getTime()))].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < times.length; i++) {
    // Une heure de marge pour les changements d'heure.
    run = i > 0 && Math.abs(times[i] - times[i - 1] - WEEK_MS) < 3600_000 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export async function retroFor(userId: string, year: number): Promise<RetroState> {
  const start = sql`make_timestamptz(${year}::int, 1, 1, 0, 0, 0, 'Europe/Paris')`;
  const end = sql`make_timestamptz(${year + 1}::int, 1, 1, 0, 0, 0, 'Europe/Paris')`;
  const inYear = (col: SQL) => sql`${col} >= ${start} and ${col} < ${end}`;
  const one = async <T extends Record<string, unknown>>(q: SQL) => ([...(await db.execute<T>(q))][0] ?? null) as T | null;

  const posts = (await one<RetroState['posts']>(sql`
    select count(*)::int as total,
      count(*) filter (where p.kind = 'photo')::int as photos,
      count(*) filter (where p.kind = 'video')::int as videos,
      count(*) filter (where p.kind = 'poll')::int as polls,
      coalesce(sum((select count(*) from likes l where l.post_id = p.id and l.user_id <> ${userId})), 0)::int as likes,
      coalesce(sum((select count(*) from post_reactions r where r.post_id = p.id and r.user_id <> ${userId})), 0)::int as reactions,
      coalesce(sum((select count(*) from comments c where c.post_id = p.id and c.author_id <> ${userId})), 0)::int as comments
    from posts p where p.author_id = ${userId} and p.kind <> 'meme' and ${inYear(sql`p.created_at`)}`))!;

  const top = await one<{ id: string }>(sql`
    select p.id from posts p
    where p.author_id = ${userId} and p.kind <> 'meme' and p.hidden_at is null and ${inYear(sql`p.created_at`)}
    order by (select count(*) from likes l where l.post_id = p.id) + (select count(*) from post_reactions r where r.post_id = p.id)
      + (select count(*) from comments c where c.post_id = p.id) desc, p.created_at desc
    limit 1`);
  const topPost = top ? ((await selectPosts(userId, { where: sql`p.id = ${top.id}`, limit: 1 }))[0] ?? null) : null;

  const shots = [
    ...(await db.execute<{ revealAt: Date; onTime: boolean }>(sql`
      select reveal_at as "revealAt", on_time as "onTime" from shots where user_id = ${userId} and ${inYear(sql`taken_at`)}`)),
  ];
  const topShot = await one<{ mediaId: string; kind: string; width: number | null; height: number | null; likes: number }>(sql`
    select m.id as "mediaId", m.kind, m.width, m.height, (select count(*)::int from shot_likes l where l.shot_id = s.id) as likes
    from shots s join media m on m.id = s.media_id
    where s.user_id = ${userId} and s.reveal_at <= now() and ${inYear(sql`s.taken_at`)}
    order by likes desc, s.taken_at desc limit 1`);

  const memes = (await one<{ count: number; points: number; wins: number }>(sql`
    select count(*)::int as count, coalesce(sum(score), 0)::int as points, count(*) filter (where is_winner)::int as wins
    from memes where author_id = ${userId} and ${inYear(sql`created_at`)}`))!;
  const best = await one<{ caption: string; mediaId: string; kind: string; width: number | null; height: number | null; score: number }>(sql`
    select mm.caption, m.id as "mediaId", m.kind, m.width, m.height, mm.score
    from memes mm join media m on m.id = mm.media_id
    where mm.author_id = ${userId} and mm.score > 0 and ${inYear(sql`mm.created_at`)}
    order by mm.score desc, mm.created_at desc limit 1`);

  const guesses = (await one<{ hits: number; played: number }>(sql`
    select (select count(*)::int from shot_guesses where user_id = ${userId} and correct and ${inYear(sql`created_at`)}) as hits,
      (select count(*)::int from guess_rounds where user_id = ${userId} and ${inYear(sql`created_at`)}) as played`))!;

  const sent = (await one<{ n: number }>(sql`
    select count(*)::int as n from messages
    where sender_id = ${userId} and deleted_at is null and coalesce(meta->>'type', '') <> 'system' and ${inYear(sql`created_at`)}`))!.n;
  // Ami avec qui l'on a le plus échangé (messages à deux, dans les deux sens).
  const buddy = await one<{ userId: string; n: number }>(sql`
    select other.user_id as "userId", count(*)::int as n
    from messages m
    join conversations c on c.id = m.conversation_id and not c.is_group
    join conversation_members mine on mine.conversation_id = c.id and mine.user_id = ${userId}
    join conversation_members other on other.conversation_id = c.id and other.user_id <> ${userId}
    where m.deleted_at is null and coalesce(m.meta->>'type', '') <> 'system' and ${inYear(sql`m.created_at`)}
    group by other.user_id order by n desc limit 1`);
  const emoji = await one<{ emoji: string }>(sql`
    select emoji from (
      select emoji, created_at from post_reactions where user_id = ${userId}
      union all select emoji, created_at from message_reactions where user_id = ${userId}
    ) r where ${inYear(sql`r.created_at`)}
    group by emoji order by count(*) desc limit 1`);

  const friends = await friendIds(userId);
  const added = (await one<{ n: number }>(sql`
    select count(*)::int as n from friendships
    where status = 'accepted' and (requester_id = ${userId} or addressee_id = ${userId}) and ${inYear(sql`created_at`)}`))!.n;

  // Mois le plus actif : posts, photos de la Pellicule et messages.
  const month = await one<{ m: number; n: number }>(sql`
    select m, count(*)::int as n from (
      select extract(month from created_at at time zone 'Europe/Paris')::int as m from posts where author_id = ${userId} and ${inYear(sql`created_at`)}
      union all select extract(month from taken_at at time zone 'Europe/Paris')::int from shots where user_id = ${userId} and ${inYear(sql`taken_at`)}
      union all select extract(month from created_at at time zone 'Europe/Paris')::int from messages where sender_id = ${userId} and ${inYear(sql`created_at`)}
    ) t group by m order by n desc, m asc limit 1`);

  const circle = (await one<RetroState['circle']>(sql`
    select (select count(*)::int from users where suspended_at is null and created_at < ${end}) as members,
      (select count(*)::int from posts where ${inYear(sql`created_at`)}) as posts,
      (select count(*)::int from shots where ${inYear(sql`taken_at`)}) as shots`))!;

  const people = await usersByIds(buddy ? [buddy.userId] : [], userId);
  const activity = posts.total + shots.length + memes.count + sent;
  return {
    year,
    enough: activity >= 3,
    posts,
    topPost,
    pellicule: {
      shots: shots.length,
      weeks: new Set(shots.map((s) => new Date(s.revealAt).getTime())).size,
      onTime: shots.filter((s) => s.onTime).length,
      bestStreak: longestStreak(shots.map((s) => new Date(s.revealAt))),
      topShot: topShot ? { media: mediaRef({ id: topShot.mediaId, kind: topShot.kind, width: topShot.width, height: topShot.height })!, likes: topShot.likes } : null,
    },
    memes: {
      ...memes,
      best: best ? { caption: best.caption, media: mediaRef({ id: best.mediaId, kind: best.kind, width: best.width, height: best.height })!, score: best.score } : null,
    },
    guesses,
    messages: {
      sent,
      topFriend: buddy && people.get(buddy.userId) ? { user: people.get(buddy.userId)!, count: buddy.n } : null,
      emoji: emoji?.emoji ?? null,
    },
    friends: { total: friends.length, added },
    busiestMonth: month ? { month: `${year}-${String(month.m).padStart(2, '0')}`, label: MONTHS[month.m - 1], count: month.n } : null,
    circle,
  };
}
