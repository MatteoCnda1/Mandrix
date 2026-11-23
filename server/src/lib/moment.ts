import type { MomentInfo } from '@mandrix/shared';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';
import { notifyMany } from './notify.js';

// « Moment Mandrix » : chaque jour, à une heure tirée au hasard, tout le monde est invité
// à prendre sa photo dans les 10 minutes. Le même horaire vaut pour tous les membres.

export const MOMENT_WINDOW_MS = 10 * 60_000;

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `moment:${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function readMoment(day: Date): Promise<Date | null> {
  const [r] = await db.select().from(schema.settings).where(eq(schema.settings.key, dayKey(day))).limit(1);
  if (!r || r.value === 'none') return null;
  const at = new Date(r.value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** Tire l'horaire du jour (entre MOMENT_START_HOUR et MOMENT_END_HOUR) s'il ne l'est pas déjà. */
async function ensureMoment(day: Date): Promise<Date | null> {
  const key = dayKey(day);
  const [existing] = await db.select().from(schema.settings).where(eq(schema.settings.key, key)).limit(1);
  if (existing) return existing.value === 'none' ? null : new Date(existing.value);

  const start = new Date(day);
  start.setHours(env.momentStartHour, 0, 0, 0);
  const end = new Date(day);
  end.setHours(env.momentEndHour, 0, 0, 0);
  // Premier démarrage en cours de journée : pas d'horaire dans le passé.
  const earliest = new Date(Math.max(start.getTime(), Date.now() + 5 * 60_000));
  let value = 'none';
  if (earliest < end) value = new Date(earliest.getTime() + Math.random() * (end.getTime() - earliest.getTime())).toISOString();
  await db.insert(schema.settings).values({ key, value }).onConflictDoNothing();
  return readMoment(day);
}

export async function activeMoment(now = new Date()): Promise<MomentInfo | null> {
  if (!env.momentEnabled) return null;
  const at = await readMoment(now);
  if (!at || now < at || now.getTime() > at.getTime() + MOMENT_WINDOW_MS) return null;
  return { at: at.toISOString(), endsAt: new Date(at.getTime() + MOMENT_WINDOW_MS).toISOString() };
}

/** La photo a-t-elle été prise dans les 10 minutes du moment de ce jour-là ? */
export async function isOnTime(takenAt: Date): Promise<boolean> {
  if (!env.momentEnabled) return false;
  const at = await readMoment(takenAt);
  return !!at && takenAt >= at && takenAt.getTime() <= at.getTime() + MOMENT_WINDOW_MS;
}

let timer: NodeJS.Timeout | undefined;

async function fire(at: Date) {
  const users = await db.execute<{ id: string }>(sql`select id from users`);
  await notifyMany(
    [...users].map((u) => u.id),
    'moment',
    { at: at.toISOString() },
    { title: 'C’est le moment Mandrix 📸', body: 'Tu as 10 minutes pour prendre ta photo de la Pellicule.', url: '/pellicule', tag: 'moment' },
    dayKey(at),
  );
}

/** Programme le moment du jour (appelé au démarrage et chaque nuit). */
export async function scheduleTodayMoment() {
  clearTimeout(timer);
  if (!env.momentEnabled) return;
  const at = await ensureMoment(new Date());
  if (!at) return;
  const delay = at.getTime() - Date.now();
  if (delay <= 0) return;
  timer = setTimeout(() => fire(at).catch((e) => console.error('[moment]', e)), delay);
}
