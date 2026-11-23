import { Cron } from 'croner';
import { sql } from 'drizzle-orm';
import { db } from './db/index.js';
import { env } from './env.js';
import { DAILY } from '@mandrix/shared';
import { announceVote, closeDaily, drawDaily, parisDay, shiftDay } from './lib/daily.js';
import { deleteMediaFile, variantPath } from './lib/media.js';
import { scheduleTodayMoment } from './lib/moment.js';
import { notifyMany } from './lib/notify.js';
import { parisHour } from './lib/push.js';
import { notifyEndedPolls } from './lib/polls.js';
import { prevReveal } from './lib/week.js';

const cronDay = (d: number) => ((d % 7) + 7) % 7;

export function startJobs() {
  // Sondages arrivés à leur fin : l'auteur reçoit le résultat.
  new Cron('*/5 * * * *', { protect: true }, async () => void (await notifyEndedPolls()));

  // Mème du jour (heures de Paris) : tirage le matin, votes le soir, clôture après minuit.
  const paris = { protect: true, timezone: 'Europe/Paris' };
  new Cron(`0 ${DAILY.drawHour} * * *`, paris, async () => void (await drawDaily()));
  new Cron(`0 ${DAILY.voteHour} * * *`, paris, () => announceVote());
  new Cron('5 0 * * *', paris, () => closeDaily(shiftDay(parisDay(), -1)));
  // Serveur redémarré dans la journée : rattrape le tirage (sans notification) et la clôture d'hier.
  void (async () => {
    await closeDaily(shiftDay(parisDay(), -1));
    if (parisHour() >= DAILY.drawHour) await drawDaily(parisDay(), false);
  })().catch((e) => console.error('[daily]', e));

  // « Moment Mandrix » : horaire tiré chaque nuit, et au démarrage du serveur.
  void scheduleTodayMoment().catch((e) => console.error('[moment]', e));
  new Cron('1 0 * * *', { protect: true }, () => scheduleTodayMoment());

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
    const orphans = await db.execute<{ id: string; path: string; posterPath: string | null; sourcePath: string | null; variants: number[] | null }>(sql`
      select m.id, m.path, m.poster_path as "posterPath", m.source_path as "sourcePath", m.variants from media m
      where m.created_at < now() - interval '1 day'
        and not exists (select 1 from posts p where p.media_id = m.id)
        and not exists (select 1 from poll_options o where o.media_id = m.id)
        and not exists (select 1 from stories s where s.media_id = m.id and s.expires_at > now() - interval '2 days')
        and not exists (select 1 from shots s where s.media_id = m.id)
        and not exists (select 1 from pool_items pi where pi.media_id = m.id)
        and not exists (select 1 from memes mm where mm.media_id = m.id)
        and not exists (select 1 from users u where u.avatar_media_id = m.id)
        and not exists (select 1 from messages msg where msg.meta->'media'->>'id' = m.id::text)
        and not exists (select 1 from messages msg where msg.media_id = m.id)
        and not exists (select 1 from daily_memes d where d.media_id = m.id)
      limit 500`);
    for (const o of orphans) {
      await db.execute(sql`delete from media where id = ${o.id}`);
      await deleteMediaFile(o.path);
      if (o.posterPath) await deleteMediaFile(o.posterPath);
      if (o.sourcePath) await deleteMediaFile(o.sourcePath);
      for (const w of o.variants ?? []) await deleteMediaFile(variantPath(o.path, w));
    }
    await db.execute(sql`delete from stories where expires_at < now() - interval '2 days'`);
    await db.execute(sql`delete from sessions where expires_at < now()`);
    await db.execute(sql`delete from notifications where created_at < now() - interval '90 days'`);
  });
}
