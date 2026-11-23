import type { DailyState, SeasonState } from '@mandrix/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireUser } from '../lib/auth.js';
import { dailyView, parisDay, phaseOf, shiftDay } from '../lib/daily.js';
import { fail, parse } from '../lib/http.js';
import { usersByIds } from '../lib/users.js';
import { perMinute } from '../lib/limits.js';

const { dailyMemes, dailyCaptions, dailyVotes } = schema;

const monthLabel = (month: string) => {
  const label = new Date(`${month}-15T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
  return `Saison de ${label}`;
};

export default async function dailyRoutes(app: FastifyInstance) {
  app.get('/api/daily', async (req): Promise<DailyState> => {
    const me = requireUser(req);
    const today = parisDay();
    return { today: await dailyView(today, me.id), yesterday: await dailyView(shiftDay(today, -1), me.id) };
  });

  /** Ma légende du jour : une par personne, modifiable jusqu'à l'ouverture des votes. */
  app.put('/api/daily/caption', perMinute(20), async (req) => {
    const me = requireUser(req);
    const { text } = parse(z.object({ text: z.string().trim().min(1, 'Écris ta légende').max(120) }), req.body);
    const day = parisDay();
    const [d] = await db.select().from(dailyMemes).where(eq(dailyMemes.day, day)).limit(1);
    if (!d) fail(404, 'Pas de mème du jour pour l’instant');
    if (phaseOf(day) !== 'caption') fail(409, 'Les votes ont commencé : les légendes sont fermées');
    await db
      .insert(dailyCaptions)
      .values({ day, userId: me.id, text })
      .onConflictDoUpdate({ target: [dailyCaptions.day, dailyCaptions.userId], set: { text, updatedAt: new Date() } });
    return dailyView(day, me.id);
  });

  app.delete('/api/daily/caption', async (req) => {
    const me = requireUser(req);
    const day = parisDay();
    if (phaseOf(day) !== 'caption') fail(409, 'Les votes ont commencé : les légendes sont fermées');
    await db.delete(dailyCaptions).where(and(eq(dailyCaptions.day, day), eq(dailyCaptions.userId, me.id)));
    return dailyView(day, me.id);
  });

  app.post('/api/daily/vote', async (req) => {
    const me = requireUser(req);
    const { captionId } = parse(z.object({ captionId: z.string().uuid() }), req.body);
    const day = parisDay();
    if (phaseOf(day) !== 'vote') fail(409, 'Les votes ne sont pas ouverts');
    const [c] = await db.select().from(dailyCaptions).where(and(eq(dailyCaptions.id, captionId), eq(dailyCaptions.day, day))).limit(1);
    if (!c) fail(404, 'Légende introuvable');
    if (c!.userId === me.id) fail(400, 'Tu ne peux pas voter pour ta propre légende');
    await db
      .insert(dailyVotes)
      .values({ day, userId: me.id, captionId })
      .onConflictDoUpdate({ target: [dailyVotes.day, dailyVotes.userId], set: { captionId, createdAt: new Date() } });
    return dailyView(day, me.id);
  });

  /** Classement de la saison (mois) : points des parties et des mèmes du jour. */
  app.get('/api/season', async (req): Promise<SeasonState> => {
    requireUser(req);
    const current = parisDay().slice(0, 7);
    const q = String((req.query as { month?: string }).month ?? current);
    const month = /^\d{4}-\d{2}$/.test(q) ? q : current;
    const rows = await db.execute<{ authorId: string; points: number; memes: number; wins: number }>(sql`
      select author_id as "authorId", sum(score)::int as points, count(*)::int as memes, count(*) filter (where is_winner)::int as wins
      from memes
      where to_char(created_at at time zone 'Europe/Paris', 'YYYY-MM') = ${month}
      group by author_id having sum(score) > 0
      order by points desc, wins desc
      limit 50`);
    const past = await db.execute<{ month: string; authorId: string; points: number }>(sql`
      select distinct on (month) month, author_id as "authorId", points from (
        select to_char(created_at at time zone 'Europe/Paris', 'YYYY-MM') as month, author_id, sum(score)::int as points
        from memes group by 1, 2
      ) t
      where month < ${current} and points > 0
      order by month desc, points desc
      limit 12`);
    const people = await usersByIds([...[...rows].map((r) => r.authorId), ...[...past].map((r) => r.authorId)]);
    return {
      month,
      label: monthLabel(month),
      ranking: [...rows]
        .filter((r) => people.has(r.authorId))
        .map((r) => ({ user: people.get(r.authorId)!, points: r.points, memes: r.memes, wins: r.wins })),
      champions: [...past]
        .filter((r) => people.has(r.authorId))
        .map((r) => ({ month: r.month, label: monthLabel(r.month), user: people.get(r.authorId)!, points: r.points })),
    };
  });
}
