import { Cron } from 'croner';
import { sql } from 'drizzle-orm';
import { db } from './db/index.js';
import { env } from './env.js';
import { deleteMediaFile } from './lib/media.js';
import { notifyMany } from './lib/notify.js';
import { prevReveal } from './lib/week.js';

const cronDay = (d: number) => ((d % 7) + 7) % 7;

export function startJobs() {
  // Dimanche 20h : le déballage s'ouvre pour tout le monde.
  new Cron(`0 ${env.revealHour} * * ${cronDay(env.revealDay)}`, { protect: true }, async () => {
    const revealAt = prevReveal(new Date(Date.now() + 1000));
    const [c] = await db.execute<{ count: number }>(sql`select count(*)::int as count from shots where reveal_at = ${revealAt.toISOString()}::timestamptz`);
    if (!c?.count) return;
    const users = await db.execute<{ id: string }>(sql`select id from users`);
    await notifyMany(
      [...users].map((u) => u.id),
      'unpack',
      { count: c.count },
      { title: 'Le déballage est ouvert 📦', body: `${c.count} photos de la semaine t'attendent.`, url: '/deballage', tag: 'unpack' },
      `unpack:${revealAt.toISOString()}`,
    );
  });

  // Veille du déballage, 18h : rappel pour ne pas casser sa série.
  new Cron(`0 18 * * ${cronDay(env.revealDay - 1)}`, { protect: true }, async () => {
    const rows = await db.execute<{ id: string }>(sql`
      select u.id from users u
      where exists (select 1 from shots s where s.user_id = u.id and s.reveal_at <= now() and s.reveal_at > now() - interval '8 days')
        and not exists (select 1 from shots s where s.user_id = u.id and s.reveal_at > now())`);
    const ids = [...rows].map((r) => r.id);
    if (ids.length === 0) return;
    await notifyMany(
      ids,
      'streak',
      {},
      { title: 'Ta série est en jeu 🔥', body: 'Prends ta photo de la semaine avant le déballage de demain.', url: '/pellicule', tag: 'streak' },
      `streak:${new Date().toISOString().slice(0, 10)}`,
    );
  });

  // Chaque nuit : ménage des médias orphelins, sessions et notifications expirées.
  new Cron('30 4 * * *', { protect: true }, async () => {
    const orphans = await db.execute<{ id: string; path: string }>(sql`
      select m.id, m.path from media m
      where m.created_at < now() - interval '1 day'
        and not exists (select 1 from posts p where p.media_id = m.id)
        and not exists (select 1 from poll_options o where o.media_id = m.id)
        and not exists (select 1 from stories s where s.media_id = m.id and s.expires_at > now() - interval '2 days')
        and not exists (select 1 from shots s where s.media_id = m.id)
        and not exists (select 1 from pool_items pi where pi.media_id = m.id)
        and not exists (select 1 from memes mm where mm.media_id = m.id)
        and not exists (select 1 from users u where u.avatar_media_id = m.id)
      limit 500`);
    for (const o of orphans) {
      await db.execute(sql`delete from media where id = ${o.id}`);
      await deleteMediaFile(o.path);
    }
    await db.execute(sql`delete from stories where expires_at < now() - interval '2 days'`);
    await db.execute(sql`delete from sessions where expires_at < now()`);
    await db.execute(sql`delete from notifications where created_at < now() - interval '90 days'`);
  });
}
