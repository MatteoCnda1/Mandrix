import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { sql } from '../src/db/index.js';

export interface TestUser {
  id: string;
  username: string;
  cookie: string;
}

export let app: FastifyInstance;

/** Une app neuve et une base vide pour chaque fichier de test. */
export function useApp() {
  beforeAll(async () => {
    await resetDb();
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await sql.end({ timeout: 5 });
  });
}

export async function resetDb() {
  const tables = await sql<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public'`;
  if (tables.length) await sql.unsafe(`truncate table ${tables.map((t) => `"${t.tablename}"`).join(', ')} restart identity cascade`);
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Requête JSON authentifiée ; renvoie le statut et le corps décodé. */
export async function call<T = any>(user: TestUser | null, method: Method, url: string, body?: unknown) {
  const res = await app.inject({
    method,
    url,
    headers: { ...(user ? { cookie: user.cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: T | undefined;
  try {
    json = res.json() as T;
  } catch {
    json = undefined;
  }
  return { status: res.statusCode, body: json as T, raw: res };
}

const cookieOf = (setCookie: string | string[] | undefined) => {
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return (first ?? '').split(';')[0];
};

export async function register(username: string, inviteCode: string | undefined = 'MASTER-TEST') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ username, email: `${username}@test.local`, password: 'motdepasse1', inviteCode }),
  });
  return { status: res.statusCode, body: res.json(), cookie: cookieOf(res.headers['set-cookie']) };
}

/** Crée un compte (avec le code maître) et renvoie de quoi l'utiliser. */
export async function makeUser(prefix: string): Promise<TestUser> {
  const username = `${prefix}_${randomBytes(3).toString('hex')}`.slice(0, 20).toLowerCase();
  const r = await register(username);
  if (r.status !== 200) throw new Error(`Inscription impossible (${r.status}) : ${JSON.stringify(r.body)}`);
  return { id: r.body.id, username, cookie: r.cookie };
}

export async function befriend(a: TestUser, b: TestUser) {
  await call(a, 'POST', `/api/friends/${b.id}`);
  await call(b, 'POST', `/api/friends/${a.id}`);
}

/** Corps multipart minimal (champs texte puis un fichier). */
export function multipart(fields: Record<string, string>, file: { name: string; type: string; data: Buffer }) {
  const boundary = `----mandrix${randomBytes(6).toString('hex')}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`));
  parts.push(file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

export async function upload<T = any>(user: TestUser, url: string, file: { name: string; type: string; data: Buffer }, fields: Record<string, string> = {}) {
  const mp = multipart(fields, file);
  const res = await app.inject({ method: 'POST', url, headers: { cookie: user.cookie, 'content-type': mp.contentType }, payload: mp.payload });
  return { status: res.statusCode, body: res.json() as T };
}

export async function jpeg(color = '#2A9DF4', w = 400, h = 300) {
  const data = await sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer();
  return { name: 'photo.jpg', type: 'image/jpeg', data };
}

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
