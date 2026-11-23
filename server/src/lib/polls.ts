import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { notify } from './notify.js';

/** Prévient l'auteur des sondages terminés, avec le résultat. */
export async function notifyEndedPolls() {
  const rows = await db.execute<{ id: string; authorId: string; text: string; pollKind: string; total: number; top: string | null; avg: number | null }>(sql`
    update posts p set poll_notified_at = now()
    where p.kind = 'poll' and p.poll_ends_at <= now() and p.poll_notified_at is null
    returning p.id, p.author_id as "authorId", p.text, p.poll_kind as "pollKind",
      (select count(*)::int from poll_votes v where v.post_id = p.id) as total,
      (select o.label from poll_options o where o.post_id = p.id
        order by (select count(*) from poll_votes v where v.option_id = o.id) desc, o.position limit 1) as top,
      (select round(avg(v.value))::int from poll_votes v where v.post_id = p.id) as avg`);
  for (const r of rows) {
    const result =
      r.total === 0
        ? 'Personne n’a voté.'
        : r.pollKind === 'slider'
          ? `Moyenne : ${r.avg ?? 0} / 100 (${r.total} vote${r.total > 1 ? 's' : ''}).`
          : `« ${r.top} » l’emporte (${r.total} vote${r.total > 1 ? 's' : ''}).`;
    await notify({
      userId: r.authorId,
      type: 'poll_ended',
      data: { postId: r.id, question: r.text.slice(0, 80), result, total: r.total },
      push: { title: 'Ton sondage est terminé 📊', body: `${r.text.slice(0, 60)} — ${result}`, url: `/p/${r.id}`, tag: `poll:${r.id}` },
    });
  }
  return rows.length;
}
