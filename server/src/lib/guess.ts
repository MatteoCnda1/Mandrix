import { createHash } from 'node:crypto';
import { GUESS, type GuessItem, type GuessState, type GuessStatus, type UserLite } from '@mandrix/shared';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { fail } from './http.js';
import { mediaRef } from './media.js';
import { usersByIds } from './users.js';
import { weekLabel } from './week.js';

// « Qui a pris ça ? » : avant de déballer la semaine, chacun devine l'auteur de quelques photos.
// Sélection et choix proposés sont tirés au hasard mais stables (empreinte de la photo et du joueur) :
// recharger la page ne change rien.

const { shotGuesses, guessRounds } = schema;
const hash = (...parts: string[]) => createHash('md5').update(parts.join(':')).digest('hex');

/** Dernière semaine déballée (null si aucun dimanche n'est encore passé). */
export async function lastRevealAt(): Promise<Date | null> {
  const [last] = await db.execute<{ r: Date | null }>(sql`select max(reveal_at) as r from shots where reveal_at <= now()`);
  return last?.r ? new Date(last.r) : null;
}

interface QuizPhoto {
  shotId: string;
  authorId: string;
  media: NonNullable<ReturnType<typeof mediaRef>>;
  options: string[];
}

/** Photos du quiz d'un joueur pour une semaine : jusqu'à 8, pas les siennes, réparties entre les auteurs. */
async function quizFor(userId: string, revealAt: Date): Promise<QuizPhoto[]> {
  const at = revealAt.toISOString();
  const authors = [
    ...(await db.execute<{ id: string }>(sql`select distinct user_id as id from shots where reveal_at = ${at}::timestamptz and user_id <> ${userId}`)),
  ].map((r) => r.id);
  // Deviner entre une seule personne n'a pas d'intérêt.
  if (authors.length < 2) return [];
  const rows = await db.execute<{ id: string; userId: string; mediaId: string; kind: string; width: number | null; height: number | null }>(sql`
    with others as (
      select s.id, s.user_id, m.id as media_id, m.kind, m.width, m.height,
        row_number() over (partition by s.user_id order by md5(s.id::text || ${userId})) as rn
      from shots s join media m on m.id = s.media_id
      where s.reveal_at = ${at}::timestamptz and s.user_id <> ${userId} and m.kind = 'image'
    )
    select id, user_id as "userId", media_id as "mediaId", kind, width, height from others
    order by rn, md5(id::text || ${userId}) limit ${GUESS.maxPhotos}`);
  return [...rows].map((r) => {
    const others = authors
      .filter((a) => a !== r.userId)
      .sort((a, b) => hash(r.id, a).localeCompare(hash(r.id, b)))
      .slice(0, GUESS.choices - 1);
    const options = [r.userId, ...others].sort((a, b) => hash(r.id, a, 'o').localeCompare(hash(r.id, b, 'o')));
    return { shotId: r.id, authorId: r.userId, media: mediaRef({ id: r.mediaId, kind: r.kind, width: r.width, height: r.height })!, options };
  });
}

async function roundOf(userId: string, revealAt: Date) {
  const [r] = await db
    .select()
    .from(guessRounds)
    .where(and(eq(guessRounds.userId, userId), eq(guessRounds.revealAt, revealAt)))
    .limit(1);
  return r ?? null;
}

async function myGuesses(userId: string, shotIds: string[]) {
  if (shotIds.length === 0) return new Map<string, { guessedId: string | null; correct: boolean }>();
  const rows = await db.execute<{ shotId: string; guessedId: string | null; correct: boolean }>(sql`
    select shot_id as "shotId", guessed_id as "guessedId", correct from shot_guesses
    where user_id = ${userId} and shot_id in (${sql.join(shotIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
  return new Map([...rows].map((r) => [r.shotId, { guessedId: r.guessedId, correct: r.correct }]));
}

/** Où en est le joueur pour une semaine (sans tout charger). */
export async function quizStatus(userId: string, revealAt: Date): Promise<GuessStatus> {
  const round = await roundOf(userId, revealAt);
  if (round) return round.status;
  return (await quizFor(userId, revealAt)).length ? 'todo' : 'none';
}

export async function guessState(userId: string, revealAt: Date): Promise<GuessState> {
  const quiz = await quizFor(userId, revealAt);
  const round = await roundOf(userId, revealAt);
  const status: GuessStatus = round ? round.status : quiz.length ? 'todo' : 'none';
  const guesses = await myGuesses(userId, quiz.map((q) => q.shotId));
  const ranking = [
    ...(await db.execute<{ userId: string; score: number }>(sql`
      select user_id as "userId", score from guess_rounds
      where reveal_at = ${revealAt.toISOString()}::timestamptz and status = 'done'
      order by score desc, created_at asc limit 30`)),
  ];
  const people = await usersByIds([...quiz.flatMap((q) => q.options), ...ranking.map((r) => r.userId)], userId);
  const user = (id: string): UserLite => people.get(id) ?? { id, username: '?', displayName: 'Ancien membre', avatarUrl: null, initials: '?', tone: 0 };
  const items: GuessItem[] = quiz.map((q) => {
    const g = guesses.get(q.shotId);
    const shown = !!g || status === 'done' || status === 'skipped';
    return { shotId: q.shotId, media: q.media, options: q.options.map(user), myGuess: g?.guessedId ?? null, answer: shown ? user(q.authorId) : null };
  });
  const hits = [...guesses.values()].filter((g) => g.correct).length;
  return {
    revealAt: revealAt.toISOString(),
    weekLabel: weekLabel(revealAt),
    status,
    items,
    score: round?.score ?? hits * GUESS.pointsPerHit,
    ranking: ranking.map((r) => ({ user: user(r.userId), score: r.score, hits: Math.round(r.score / GUESS.pointsPerHit) })),
  };
}

/** Enregistre une réponse ; la partie se termine à la dernière photo. */
export async function answer(userId: string, shotId: string, guessedId: string) {
  const revealAt = await lastRevealAt();
  if (!revealAt) return fail(404, 'Aucun déballage pour l’instant');
  if ((await roundOf(userId, revealAt))?.status) fail(409, 'Partie déjà terminée');
  const quiz = await quizFor(userId, revealAt);
  const item = quiz.find((q) => q.shotId === shotId);
  if (!item) return fail(404, 'Photo introuvable dans ta partie');
  if (!item.options.includes(guessedId)) fail(400, 'Choisis l’un des visages proposés');
  const [saved] = await db
    .insert(shotGuesses)
    .values({ userId, shotId, guessedId, correct: guessedId === item.authorId })
    .onConflictDoNothing()
    .returning();
  if (!saved) fail(409, 'Tu as déjà répondu pour cette photo');
  const guesses = await myGuesses(userId, quiz.map((q) => q.shotId));
  if (guesses.size >= quiz.length) await closeRound(userId, revealAt, 'done', guesses);
  return guessState(userId, revealAt);
}

/** Passer : le Déballage s'ouvre, les réponses déjà données gardent leurs points. */
export async function skip(userId: string) {
  const revealAt = await lastRevealAt();
  if (!revealAt) return fail(404, 'Aucun déballage pour l’instant');
  if (!(await roundOf(userId, revealAt))) {
    const quiz = await quizFor(userId, revealAt);
    await closeRound(userId, revealAt, 'skipped', await myGuesses(userId, quiz.map((q) => q.shotId)));
  }
  return guessState(userId, revealAt);
}

async function closeRound(userId: string, revealAt: Date, status: 'done' | 'skipped', guesses: Map<string, { correct: boolean }>) {
  const hits = [...guesses.values()].filter((g) => g.correct).length;
  await db.insert(guessRounds).values({ userId, revealAt, status, score: hits * GUESS.pointsPerHit }).onConflictDoNothing();
}
