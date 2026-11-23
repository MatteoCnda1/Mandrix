import postgres from 'postgres';

const DEFAULT_URL = 'postgres://mandrix:mandrix@localhost:5433/mandrix_test';

/** Crée la base de test si besoin et applique les migrations (une fois pour toute la suite). */
export default async function setup() {
  const url = process.env.DATABASE_URL ?? DEFAULT_URL;
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';

  const target = new URL(url);
  const dbName = target.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const root = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    const [exists] = await root`select 1 from pg_database where datname = ${dbName}`;
    if (!exists) await root.unsafe(`create database "${dbName.replace(/"/g, '')}"`);
  } finally {
    await root.end({ timeout: 5 });
  }

  const { runMigrations, sql } = await import('../src/db/index.js');
  await runMigrations();
  await sql.end({ timeout: 5 });
}
