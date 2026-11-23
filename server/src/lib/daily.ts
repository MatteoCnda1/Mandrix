import { DAILY, type DailyCaption, type DailyMeme, type DailyPhase } from '@mandrix/shared';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { mediaRef } from './media.js';
import { notify, notifyMany } from './notify.js';
import { usersByIds } from './users.js';

// Mème du jour : une image du pool public tirée chaque matin, des légendes écrites quand on veut,
// des votes le soir, et des points qui comptent pour la saison (comme les parties de Make It Friends).

const { dailyMemes, dailyCaptions, dailyVotes } = schema;
const TZ = 'Europe/Paris';

/** Date du jour à Paris, « AAAA-MM-JJ ». */
export function parisDay(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function shiftDay(day: string, delta: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Instant correspondant à `hour`:00 (heure de Paris) le jour `day`. */
export function parisTime(day: string, hour: number) {
  // On part de l'heure UTC puis on corrige le décalage de Paris ce jour-là (été/hiver).
  const guess = new Date(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);
  const local = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(guess);
  const offset = Number(local) - hour;
  return new Date(guess.getTime() - ((offset + 24) % 24 > 12 ? (offset + 24) % 24 - 24 : (offset + 24) % 24) * 3600_000);
}

export function phaseOf(day: string, now = new Date()): DailyPhase {
  if (day < parisDay(now)) return 'closed';
  return now < parisTime(day, DAILY.voteHour) ? 'caption' : 'vote';
}

/** Tire l'image du jour (pool public, images peu tirées d'abord). Sans effet si elle existe déjà. */
export async function drawDaily(day = parisDay(), announce = true) {
  const [existing] = await db.select().from(dailyMemes).where(eq(dailyMemes.day, day)).limit(1);
  if (existing) return existing;
  const [pick] = await db.execute<{ id: string; mediaId: string }>(sql`
    select pi.id, pi.media_id as "mediaId" from pool_items pi join media m on m.id = pi.media_id
    where pi.status = 'active' and pi.scope = 'public' and m.kind = 'image'
      and not exists (select 1 from daily_memes d where d.media_id = pi.media_id and d.day > ${shiftDay(day, -60)}::date)
    order by pi.draws asc, random() limit 1`);
  if (!pick) return null;
  const [row] = await db.insert(dailyMemes).values({ day, mediaId: pick.mediaId }).onConflictDoNothing().returning();
  if (!row) return (await db.select().from(dailyMemes).where(eq(dailyMemes.day, day)).limit(1))[0] ?? null;
  await db.execute(sql`update pool_items set draws = draws + 1 where id = ${pick.id}`);
  if (announce) {
    const users = await db.execute<{ id: string }>(sql`select id from users where suspended_at is null`);
    await notifyMany(
      [...users].map((u) => u.id),
      'daily_meme',
      { day, stage: 'draw' },
      { title: 'Le mème du jour est arrivé 🐒', body: `Écris ta légende avant ${DAILY.voteHour}h, les votes ouvrent ce soir.`, url: '/jeu?onglet=jour', tag: 'daily' },
      `daily:${day}`,
    );
  }
  return row;
}

/** Ouverture des votes : prévient tout le monde s'il y a au moins deux légendes. */
export async function announceVote(day = parisDay()) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(dailyCaptions).where(eq(dailyCaptions.day, day));
  if (n < 2) return;
  const users = await db.execute<{ id: string }>(sql`select id from users where suspended_at is null`);
  await notifyMany(
    [...users].map((u) => u.id),
    'daily_meme',
    { day, stage: 'vote', count: n },
    { title: 'Votes ouverts 🗳️', body: `${n} légendes pour le mème du jour. Choisis ta préférée avant minuit.`, url: '/jeu?onglet=jour', tag: 'daily' },
    `daily:${day}`,
  );
}

/** Clôture : compte les votes, enregistre les points de saison et prévient le gagnant. */
export async function closeDaily(day: string) {
  const [d] = await db.select().from(dailyMemes).where(eq(dailyMemes.day, day)).limit(1);
  if (!d || d.closedAt) return;
  await db.execute(sql`
    update daily_captions c set votes = (select count(*)::int from daily_votes v where v.caption_id = c.id)
    where c.day = ${day}::date`);
  const captions = await db.select().from(dailyCaptions).where(eq(dailyCaptions.day, day));
  const ranked = [...captions].sort((a, b) => b.votes - a.votes || a.createdAt.getTime() - b.createdAt.getTime());
  const winner = ranked[0] && ranked[0].votes > 0 ? ranked[0] : null;
  if (captions.length) {
    // Les légendes rejoignent la table des mèmes : la saison additionne parties et mèmes du jour.
    await db.insert(schema.memes).values(
      ranked.map((c) => ({
        authorId: c.userId,
        mediaId: d.mediaId,
        caption: c.text,
        score: c.votes * DAILY.pointsPerVote + (winner?.id === c.id ? DAILY.winnerBonus : 0),
        isWinner: winner?.id === c.id,
        gameCode: `JOUR-${day}`,
        round: 1,
        createdAt: parisTime(day, 23),
      })),
    );
  }
  await db.update(dailyMemes).set({ closedAt: new Date() }).where(eq(dailyMemes.day, day));
  if (winner) {
    await notify({
      userId: winner.userId,
      type: 'daily_meme',
      data: { day, stage: 'won', votes: winner.votes },
      push: { title: 'Tu as gagné le mème du jour 🏆', body: `${winner.votes} vote${winner.votes > 1 ? 's' : ''} pour « ${winner.text.slice(0, 60)} »`, url: '/jeu?onglet=jour', tag: 'daily' },
    });
  }
}

/** Vue d'un mème du jour pour un lecteur. */
export async function dailyView(day: string, viewerId: string): Promise<DailyMeme | null> {
  const [d] = await db
    .select({ d: dailyMemes, m: schema.media })
    .from(dailyMemes)
    .innerJoin(schema.media, eq(schema.media.id, dailyMemes.mediaId))
    .where(eq(dailyMemes.day, day))
    .limit(1);
  if (!d) return null;
  const phase = phaseOf(day);
  const captions = await db.select().from(dailyCaptions).where(eq(dailyCaptions.day, day));
  const [vote] = await db.select().from(dailyVotes).where(and(eq(dailyVotes.day, day), eq(dailyVotes.userId, viewerId))).limit(1);
  const mine = captions.find((c) => c.userId === viewerId);

  let list: DailyCaption[] = [];
  if (phase === 'vote') {
    // Ordre stable mais mélangé, et anonyme pour ne pas voter « pour un ami ».
    list = [...captions]
      .sort((a, b) => hash(a.id + viewerId) - hash(b.id + viewerId))
      .map((c) => ({ id: c.id, text: c.text, mine: c.userId === viewerId, votes: null, user: null, winner: false }));
  } else if (phase === 'closed') {
    const counts = d.d.closedAt
      ? new Map(captions.map((c) => [c.id, c.votes]))
      : new Map(
          [...(await db.execute<{ id: string; n: number }>(sql`select caption_id as id, count(*)::int as n from daily_votes where day = ${day}::date group by caption_id`))].map(
            (r) => [r.id, r.n],
          ),
        );
    const people = await usersByIds(captions.map((c) => c.userId));
    const sorted = [...captions].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.createdAt.getTime() - b.createdAt.getTime());
    list = sorted.map((c, i) => ({
      id: c.id,
      text: c.text,
      mine: c.userId === viewerId,
      votes: counts.get(c.id) ?? 0,
      user: people.get(c.userId) ?? null,
      winner: i === 0 && (counts.get(c.id) ?? 0) > 0,
    }));
  }
  return {
    day,
    media: mediaRef(d.m)!,
    phase,
    voteAt: parisTime(day, DAILY.voteHour).toISOString(),
    closeAt: parisTime(shiftDay(day, 1), 0).toISOString(),
    participants: captions.length,
    myCaption: mine?.text ?? null,
    myVote: vote?.captionId ?? null,
    captions: list,
  };
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
