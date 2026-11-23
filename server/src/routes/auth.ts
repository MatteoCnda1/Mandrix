import { USERNAME_RE, type AppConfig } from '@mandrix/shared';
import { and, eq, gt, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';
import { createSession, destroySession, hashPassword, randomToken, requireUser, sha256, verifyPassword } from '../lib/auth.js';
import { fail, parse } from '../lib/http.js';
import { mailEnabled, sendMail } from '../lib/mail.js';
import { vapidPublicKey } from '../lib/push.js';
import { toMe } from '../lib/users.js';

const password = z.string().min(8, 'Le mot de passe doit faire au moins 8 caractères').max(200);
const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_RE, 'Pseudo : 3 à 20 caractères (lettres, chiffres, point, tiret bas)');

const registerSchema = z.object({
  username,
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide'),
  password,
  inviteCode: z.string().trim().optional(),
});

const loginSchema = z.object({
  login: z.string().trim().toLowerCase().min(1, 'Renseigne ton e-mail ou ton pseudo'),
  password: z.string().min(1, 'Renseigne ton mot de passe'),
});

export default async function authRoutes(app: FastifyInstance) {
  const limited = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.get('/api/config', async (): Promise<AppConfig> => ({
    inviteRequired: !!env.inviteCode,
    mailEnabled: mailEnabled(),
    vapidPublicKey: vapidPublicKey(),
    revealDay: env.revealDay,
    revealHour: env.revealHour,
    roundSeconds: env.roundSeconds,
    maxUploadMb: env.maxUploadMb,
  }));

  app.post('/api/auth/register', limited, async (req, reply) => {
    const body = parse(registerSchema, req.body);
    if (env.inviteCode && body.inviteCode !== env.inviteCode) fail(403, "Code d'invitation incorrect");
    const existing = await db
      .select({ username: schema.users.username, email: schema.users.email })
      .from(schema.users)
      .where(or(eq(schema.users.username, body.username), eq(schema.users.email, body.email)))
      .limit(1);
    if (existing[0]) fail(409, existing[0].email === body.email ? 'Cette adresse e-mail a déjà un compte' : 'Ce pseudo est déjà pris');

    const [{ count }] = await db.execute<{ count: number }>(sql`select count(*)::int as count from users`);
    const isAdmin = count === 0 || env.adminEmails.includes(body.email);
    const [user] = await db
      .insert(schema.users)
      .values({
        username: body.username,
        displayName: body.username,
        email: body.email,
        passwordHash: await hashPassword(body.password),
        isAdmin,
      })
      .returning();
    await createSession(reply, user.id);
    return toMe(user);
  });

  app.post('/api/auth/login', limited, async (req, reply) => {
    const body = parse(loginSchema, req.body);
    const [user] = await db
      .select()
      .from(schema.users)
      .where(or(eq(schema.users.email, body.login), eq(schema.users.username, body.login)))
      .limit(1);
    if (!user || !(await verifyPassword(user.passwordHash, body.password))) fail(401, 'Identifiants incorrects');
    await createSession(reply, user!.id);
    return toMe(user!);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(req, reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => toMe(requireUser(req)));

  app.post('/api/auth/forgot', limited, async (req) => {
    const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email('Adresse e-mail invalide') }), req.body);
    if (!mailEnabled()) fail(503, "L'envoi d'e-mails n'est pas configuré sur ce serveur");
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (user) {
      const token = randomToken();
      await db.insert(schema.passwordResets).values({ id: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + 3600_000) });
      const link = `${env.appUrl}/reinitialiser?token=${token}`;
      await sendMail(
        user.email,
        'Réinitialise ton mot de passe Mandrix',
        `Salut ${user.displayName},\n\nPour choisir un nouveau mot de passe, ouvre ce lien (valable 1 heure) :\n${link}\n\nSi tu n'es pas à l'origine de cette demande, ignore ce message.`,
      );
    }
    return { ok: true };
  });

  app.post('/api/auth/reset', limited, async (req, reply) => {
    const body = parse(z.object({ token: z.string().min(10), password }), req.body);
    const [row] = await db
      .select()
      .from(schema.passwordResets)
      .where(
        and(
          eq(schema.passwordResets.id, sha256(body.token)),
          eq(schema.passwordResets.used, false),
          gt(schema.passwordResets.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!row) fail(400, 'Lien expiré ou déjà utilisé');
    await db.update(schema.passwordResets).set({ used: true }).where(eq(schema.passwordResets.id, row!.id));
    await db.update(schema.users).set({ passwordHash: await hashPassword(body.password) }).where(eq(schema.users.id, row!.userId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, row!.userId));
    await createSession(reply, row!.userId);
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, row!.userId));
    return toMe(user);
  });
}
