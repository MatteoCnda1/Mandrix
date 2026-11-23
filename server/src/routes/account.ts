import path from 'node:path';
import { NOTIF_CATEGORIES, type NotificationPrefs, type SessionInfo } from '@mandrix/shared';
import { ZipArchive } from 'archiver';
import { and, desc, eq, like, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { mediaDir } from '../env.js';
import { destroySession, hashPassword, requireUser, SESSION_COOKIE, sha256, verifyPassword } from '../lib/auth.js';
import { fail, parse } from '../lib/http.js';
import { deleteMediaFile, variantPath } from '../lib/media.js';
import { toMe } from '../lib/users.js';
import { presenceChanged } from '../realtime/presence.js';

const { users, sessions } = schema;

/** « iPhone · Safari », « Android · Chrome »… à partir du User-Agent. */
function deviceOf(ua: string | null) {
  if (!ua) return 'Appareil inconnu';
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Appareil';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur';
  return `${os} · ${browser}`;
}

const categoryKeys = NOTIF_CATEGORIES.map((c) => c.key) as [string, ...string[]];
const toggles = z.partialRecord(z.enum(categoryKeys), z.boolean()).optional();
const prefsSchema = z.object({
  push: toggles,
  bell: toggles,
  quiet: z
    .object({ start: z.number().int().min(0).max(23), end: z.number().int().min(0).max(23) })
    .nullable()
    .optional(),
});

export default async function accountRoutes(app: FastifyInstance) {
  const currentSessionId = (req: { cookies: Record<string, string | undefined> }) => {
    const token = req.cookies[SESSION_COOKIE];
    return token ? sha256(token) : null;
  };

  app.post('/api/me/password', async (req) => {
    const me = requireUser(req);
    const body = parse(
      z.object({ current: z.string().min(1, 'Mot de passe actuel requis'), next: z.string().min(8, 'Nouveau mot de passe : 8 caractères minimum').max(200) }),
      req.body,
    );
    if (!(await verifyPassword(me.passwordHash, body.current))) fail(403, 'Mot de passe actuel incorrect');
    await db.update(users).set({ passwordHash: await hashPassword(body.next) }).where(eq(users.id, me.id));
    // Les autres appareils sont déconnectés.
    const current = currentSessionId(req);
    await db.delete(sessions).where(and(eq(sessions.userId, me.id), current ? ne(sessions.id, current) : sql`true`));
    return { ok: true };
  });

  app.post('/api/me/email', async (req) => {
    const me = requireUser(req);
    const body = parse(z.object({ email: z.string().trim().toLowerCase().email('Adresse e-mail invalide'), password: z.string().min(1) }), req.body);
    if (!(await verifyPassword(me.passwordHash, body.password))) fail(403, 'Mot de passe incorrect');
    const [taken] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, body.email), ne(users.id, me.id))).limit(1);
    if (taken) fail(409, 'Cette adresse est déjà utilisée');
    const [u] = await db.update(users).set({ email: body.email }).where(eq(users.id, me.id)).returning();
    return toMe(u);
  });

  app.get('/api/me/sessions', async (req): Promise<SessionInfo[]> => {
    const me = requireUser(req);
    const current = currentSessionId(req);
    const rows = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, me.id), sql`${sessions.expiresAt} > now()`))
      .orderBy(desc(sql`coalesce(${sessions.lastSeenAt}, ${sessions.createdAt})`));
    return rows.map((s) => ({
      id: s.id.slice(0, 16),
      current: s.id === current,
      device: deviceOf(s.userAgent),
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
    }));
  });

  /** Déconnecte un appareil (identifiant court), ou tous les autres avec « others ». */
  app.delete('/api/me/sessions/:id', async (req) => {
    const me = requireUser(req);
    const { id } = req.params as { id: string };
    const current = currentSessionId(req);
    if (id === 'others') {
      await db.delete(sessions).where(and(eq(sessions.userId, me.id), current ? ne(sessions.id, current) : sql`true`));
    } else {
      if (!/^[0-9a-f]{16}$/.test(id)) fail(400, 'Session inconnue');
      if (current?.startsWith(id)) fail(400, 'Utilise « Se déconnecter » pour cet appareil');
      await db.delete(sessions).where(and(eq(sessions.userId, me.id), like(sessions.id, `${id}%`)));
    }
    return { ok: true };
  });

  /** Montrer ou masquer sa présence (« en ligne », « actif il y a … »). */
  app.patch('/api/me/presence', async (req) => {
    const me = requireUser(req);
    const { show } = parse(z.object({ show: z.boolean() }), req.body);
    const [u] = await db.update(users).set({ showPresence: show }).where(eq(users.id, me.id)).returning();
    await presenceChanged(me.id, show);
    return toMe(u);
  });

  app.patch('/api/me/notifications', async (req) => {
    const me = requireUser(req);
    const body = parse(prefsSchema, req.body) as NotificationPrefs;
    const prefs: NotificationPrefs = {
      push: { ...me.notificationPrefs?.push, ...body.push },
      bell: { ...me.notificationPrefs?.bell, ...body.bell },
      quiet: body.quiet === undefined ? (me.notificationPrefs?.quiet ?? null) : body.quiet,
    };
    const [u] = await db.update(users).set({ notificationPrefs: prefs }).where(eq(users.id, me.id)).returning();
    return toMe(u);
  });

  /** Archive zip : données en JSON lisible + photos, vidéos et vocaux (hors Pellicule encore scellée). */
  app.get('/api/me/export', async (req, reply) => {
    const me = requireUser(req);
    const q = <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) => db.execute<T>(query).then((r) => [...r]);
    const profile = { ...toMe(me), city: me.city, bio: me.bio };
    const friends = await q(sql`
      select u.username, u.display_name as "displayName", f.status, f.created_at as "since"
      from friendships f join users u on u.id = case when f.requester_id = ${me.id} then f.addressee_id else f.requester_id end
      where f.requester_id = ${me.id} or f.addressee_id = ${me.id}`);
    const posts = await q(sql`
      select p.id, p.kind, p.text, p.location, p.created_at as "createdAt", p.media_id as "mediaId",
        (select json_agg(pm.media_id order by pm.position) from post_media pm where pm.post_id = p.id) as "moreMediaIds",
        (select json_agg(json_build_object('label', o.label, 'votes', (select count(*) from poll_votes v where v.option_id = o.id)) order by o.position)
          from poll_options o where o.post_id = p.id) as options
      from posts p where p.author_id = ${me.id} order by p.created_at`);
    const comments = await q(sql`select id, post_id as "postId", text, created_at as "createdAt" from comments where author_id = ${me.id} order by created_at`);
    const messages = await q(sql`
      select m.conversation_id as "conversationId", coalesce(c.title, '') as "group", u.username as sender, m.text, m.media_id as "mediaId", m.created_at as "createdAt"
      from messages m
      join conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = ${me.id}
      join conversations c on c.id = m.conversation_id
      join users u on u.id = m.sender_id
      order by m.conversation_id, m.created_at`);
    const shots = await q(sql`
      select s.id, s.taken_at as "takenAt", s.reveal_at as "revealAt", s.on_time as "onTime", s.media_id as "mediaId"
      from shots s where s.user_id = ${me.id} and s.reveal_at <= now() order by s.taken_at`);
    const files = await q<{ id: string; path: string }>(sql`
      select id, path from media where owner_id = ${me.id} and (sealed_until is null or sealed_until <= now()) and status <> 'processing'`);

    const zip = new ZipArchive({ zlib: { level: 6 } });
    const json = (v: unknown) => JSON.stringify(v, null, 2);
    zip.append(json(profile), { name: 'profil.json' });
    zip.append(json(friends), { name: 'amis.json' });
    zip.append(json(posts), { name: 'posts.json' });
    zip.append(json(comments), { name: 'commentaires.json' });
    zip.append(json(messages), { name: 'messages.json' });
    zip.append(json(shots), { name: 'pellicule.json' });
    zip.append(
      'Export Mandrix\n\nLes fichiers JSON sont lisibles dans n’importe quel éditeur de texte.\n' +
        'Le dossier medias/ contient tes photos, vidéos et vocaux ; leur nom correspond au champ « mediaId ».\n',
      { name: 'LISEZMOI.txt' },
    );
    for (const f of files) zip.file(path.join(mediaDir, f.path), { name: `medias/${f.id}${path.extname(f.path)}` });
    void zip.finalize();
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="mandrix-${me.username}.zip"`);
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(zip);
  });

  /** Supprime le compte, ses données (cascade) et ses fichiers. */
  app.delete('/api/me', async (req, reply) => {
    const me = requireUser(req);
    const body = parse(z.object({ password: z.string().min(1), confirm: z.literal('SUPPRIMER', { error: 'Écris SUPPRIMER pour confirmer' }) }), req.body);
    if (!(await verifyPassword(me.passwordHash, body.password))) fail(403, 'Mot de passe incorrect');
    const media = await db.select().from(schema.media).where(eq(schema.media.ownerId, me.id));
    await destroySession(req, reply);
    await db.delete(users).where(eq(users.id, me.id));
    for (const m of media) {
      for (const rel of [m.path, m.posterPath, m.sourcePath, ...(m.variants ?? []).map((w) => variantPath(m.path, w))]) {
        if (rel) await deleteMediaFile(rel).catch(() => {});
      }
    }
    // Groupes restés sans membre.
    await db.execute(sql`delete from conversations c where c.is_group and not exists (select 1 from conversation_members m where m.conversation_id = c.id)`);
    return { ok: true };
  });
}
