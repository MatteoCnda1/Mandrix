import type { StreakInfo } from '@mandrix/shared';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { nextReveal } from './week.js';

export function batchesBack(n: number, from = nextReveal()): Date[] {
  const out: Date[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(from);
    d.setDate(d.getDate() - 7 * i);
    out.push(d);
  }
  return out;
}

export async function streakFor(userId: string): Promise<StreakInfo> {
  const rows = await db.execute<{ r: Date }>(sql`
    select distinct reveal_at as r from shots
    where user_id = ${userId} and reveal_at > now() - interval '420 days'`);
  const set = new Set([...rows].map((x) => new Date(x.r).getTime()));
  const all = batchesBack(60);
  const has = all.map((d) => set.has(d.getTime()));

  // La semaine en cours ne casse pas la série tant que dimanche n'est pas passé.
  let i = has.length - 1;
  if (!has[i]) i--;
  let weeks = 0;
  while (i >= 0 && has[i]) {
    weeks++;
    i--;
  }
  return { weeks, history: has.slice(-8) };
}
