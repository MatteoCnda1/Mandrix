import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const int = (v: string | undefined, d: number) => (v && !Number.isNaN(+v) ? Math.trunc(+v) : d);

if (!process.env.TZ) process.env.TZ = 'Europe/Paris';

export const env = {
  port: int(process.env.PORT, 3000),
  host: process.env.HOST ?? '0.0.0.0',
  isProd: process.env.NODE_ENV === 'production',
  appUrl: (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://mandrix:mandrix@localhost:5433/mandrix',
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(here, '../../data')),
  webDist: path.resolve(process.env.WEB_DIST ?? path.join(here, '../../web/dist')),
  migrationsDir: path.resolve(process.env.MIGRATIONS_DIR ?? path.join(here, '../drizzle')),
  inviteCode: process.env.INVITE_CODE?.trim() || null,
  adminEmails: (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  revealDay: int(process.env.PELLICULE_REVEAL_DAY, 0),
  revealHour: int(process.env.PELLICULE_REVEAL_HOUR, 20),
  roundSeconds: Math.min(120, Math.max(10, int(process.env.GAME_ROUND_SECONDS, 45))),
  maxUploadMb: int(process.env.MAX_UPLOAD_MB, 100),
  momentEnabled: (process.env.MOMENT_ENABLED ?? 'true') !== 'false',
  momentStartHour: Math.min(23, Math.max(0, int(process.env.MOMENT_START_HOUR, 10))),
  momentEndHour: Math.min(24, Math.max(1, int(process.env.MOMENT_END_HOUR, 21))),
  smtpUrl: process.env.SMTP_URL?.trim() || null,
  mailFrom: process.env.MAIL_FROM?.trim() || 'Mandrix <no-reply@mandrix.local>',
  vapidPublic: process.env.VAPID_PUBLIC_KEY?.trim() || null,
  vapidPrivate: process.env.VAPID_PRIVATE_KEY?.trim() || null,
  vapidSubject: process.env.VAPID_SUBJECT?.trim() || null,
};

export const mediaDir = path.join(env.dataDir, 'media');
