import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { env } from '../env.js';
import * as schema from './schema.js';

export const sql = postgres(env.databaseUrl, { max: 10, onnotice: () => {} });
export const db = drizzle(sql, { schema });
export type DB = typeof db;
export { schema };

export async function runMigrations() {
  // Attendre que PostgreSQL soit prêt (démarrage du conteneur sur le NAS).
  for (let i = 0; ; i++) {
    try {
      await sql`select 1`;
      break;
    } catch (err) {
      if (i >= 30) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await migrate(db, { migrationsFolder: env.migrationsDir });
}
