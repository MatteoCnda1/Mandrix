import { eq, isNull, and } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { notify } from './notify.js';
import { friendIds, parisMonthDay } from './users.js';

/** Le jour J : chaque ami reçoit « C'est l'anniversaire de … ». Sans doublon dans l'année. */
export async function announceBirthdays(day = parisMonthDay(), year = new Date().getFullYear()) {
  const people = await db
    .select({ id: schema.users.id, name: schema.users.displayName, username: schema.users.username })
    .from(schema.users)
    .where(and(eq(schema.users.birthday, day), isNull(schema.users.suspendedAt)));
  // Le 28 février, on fête aussi les 29 février les années non bissextiles.
  if (day === '02-28' && !isLeap(year)) {
    people.push(
      ...(await db
        .select({ id: schema.users.id, name: schema.users.displayName, username: schema.users.username })
        .from(schema.users)
        .where(and(eq(schema.users.birthday, '02-29'), isNull(schema.users.suspendedAt)))),
    );
  }
  let sent = 0;
  for (const p of people) {
    for (const friend of await friendIds(p.id)) {
      await notify({
        userId: friend,
        type: 'birthday',
        actorId: p.id,
        data: { name: p.name },
        dedupeKey: `birthday:${p.id}:${year}`,
        push: { title: 'Anniversaire 🎂', body: `C’est l’anniversaire de ${p.name} aujourd’hui ! Souhaite-le-lui.`, url: `/u/${p.username}`, tag: `birthday:${p.id}` },
      });
      sent++;
    }
  }
  return sent;
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
