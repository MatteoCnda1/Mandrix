import { WHOIS, type WhoisQuestion } from '@mandrix/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireUser } from '../lib/auth.js';
import { fail, parse, uuidParam } from '../lib/http.js';
import { perMinute } from '../lib/limits.js';
import { friendIds, usersByIds, uuidArray } from '../lib/users.js';

const { whoisQuestions } = schema;
/** Questions gardées par personne, au plus. */
const PER_USER = 100;

/** Questions de « Qui de nous… ? » écrites par la bande (les miennes et celles de mes amis). */
export default async function whoisRoutes(app: FastifyInstance) {
  app.get('/api/whois/questions', async (req): Promise<WhoisQuestion[]> => {
    const me = requireUser(req);
    const circle = [me.id, ...(await friendIds(me.id))];
    const rows = await db.execute<{ id: string; text: string; authorId: string; createdAt: Date }>(sql`
      select id, text, author_id as "authorId", created_at as "createdAt" from whois_questions
      where author_id = any(${uuidArray(circle)}) order by created_at desc limit 200`);
    const list = [...rows];
    const authors = await usersByIds(list.map((r) => r.authorId), me.id);
    return list
      .filter((r) => authors.has(r.authorId))
      .map((r) => ({ id: r.id, text: r.text, author: authors.get(r.authorId)!, mine: r.authorId === me.id, createdAt: new Date(r.createdAt).toISOString() }));
  });

  app.post('/api/whois/questions', perMinute(10), async (req): Promise<WhoisQuestion> => {
    const me = requireUser(req);
    const { text } = parse(
      z.object({ text: z.string().trim().min(8, 'Question trop courte').max(WHOIS.questionMax, `${WHOIS.questionMax} caractères max`) }),
      req.body,
    );
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(whoisQuestions).where(eq(whoisQuestions.authorId, me.id));
    if (n >= PER_USER) fail(400, `Tu as déjà écrit ${PER_USER} questions : supprime-en avant d’en ajouter`);
    // « Qui de nous… » est implicite : on accepte « …est le plus susceptible de… » comme la phrase complète.
    const clean = text.replace(/\s+/g, ' ');
    const final = /[?？]$/.test(clean) ? clean : `${clean} ?`;
    const [q] = await db.insert(whoisQuestions).values({ authorId: me.id, text: final }).returning();
    const author = (await usersByIds([me.id], me.id)).get(me.id)!;
    return { id: q.id, text: q.text, author, mine: true, createdAt: q.createdAt.toISOString() };
  });

  app.delete('/api/whois/questions/:id', async (req) => {
    const me = requireUser(req);
    const id = uuidParam(req.params);
    const [q] = await db.select().from(whoisQuestions).where(eq(whoisQuestions.id, id)).limit(1);
    if (!q) return fail(404, 'Question introuvable');
    if (q.authorId !== me.id && !me.isAdmin) fail(403, 'Tu ne peux supprimer que tes questions');
    await db.delete(whoisQuestions).where(and(eq(whoisQuestions.id, id)));
    return { ok: true };
  });
}
