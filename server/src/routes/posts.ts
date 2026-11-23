import { POLL_MAX_OPTIONS, REACTIONS, type Comment, type Page, type Post, type PostSearch } from '@mandrix/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireUser } from '../lib/auth.js';
import { fail, parse, uuidParam } from '../lib/http.js';
import { mediaRef, saveUpload } from '../lib/media.js';
import { notify } from '../lib/notify.js';
import { notifyMentions } from '../lib/mentions.js';
import { getPost, loadPolls, notBlocked, selectPosts, visiblePost, visibleTo } from '../lib/posts.js';
import { extractMentions } from '@mandrix/shared';
import { friendIds, usersByIds, uuidArray } from '../lib/users.js';
import { upsertPoolItem } from './pool.js';

const { posts, likes, reposts, comments, commentLikes, pollOptions, pollVotes, media, postReactions } = schema;
const PAGE = 15;

const uuid = z.string().uuid('Média invalide');
const pool = z.enum(['public', 'friends']).nullable().optional();
const location = z.string().trim().max(60).nullable().optional();

const createSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('photo'), mediaId: uuid, text: z.string().trim().max(280).default(''), location, pool }),
  z.object({ kind: z.literal('video'), mediaId: uuid, text: z.string().trim().max(280).default(''), location, pool }),
  z.object({
    kind: z.literal('poll'),
    text: z.string().trim().min(1, 'Écris ta question').max(120),
    pollKind: z.enum(['text', 'image', 'slider']),
    options: z
      .array(z.object({ label: z.string().trim().max(30), mediaId: uuid.optional() }))
      .max(POLL_MAX_OPTIONS)
      .default([]),
    /** Durée en heures (null ou absent : sans fin). */
    durationHours: z.number().int().min(1).max(24 * 30).nullable().optional(),
    isPublic: z.boolean().default(false),
  }),
]);

const pageOf = (req: { query: unknown }) => Math.max(0, Number((req.query as { page?: string }).page ?? 0) || 0);

async function postAuthor(postId: string) {
  const [p] = await db.select({ authorId: posts.authorId, kind: posts.kind }).from(posts).where(eq(posts.id, postId)).limit(1);
  if (!p) fail(404, 'Post introuvable');
  return p!;
}

async function reactionsOf(postId: string, viewerId: string) {
  const [post] = await selectPosts(viewerId, { where: sql`p.id = ${postId}`, limit: 1 });
  return { reactions: post?.reactions ?? [], myReaction: post?.myReaction ?? null };
}

const KIND_LABEL: Record<string, string> = { photo: 'ta photo', video: 'ta vidéo', poll: 'ton sondage', meme: 'ton mème' };

export default async function postRoutes(app: FastifyInstance) {
  app.post('/api/media', async (req) => {
    const me = requireUser(req);
    const file = await req.file();
    if (!file) return fail(400, 'Aucun fichier reçu');
    const row = await saveUpload(file, me.id);
    return mediaRef(row);
  });

  /** Fil paginé par curseur (date de tri + identifiant) : rien ne saute ni ne se répète quand des posts arrivent. */
  app.get('/api/feed', async (req): Promise<Page<Post>> => {
    const me = requireUser(req);
    const raw = String((req.query as { cursor?: string }).cursor ?? '');
    let after: { at: string; id: string } | null = null;
    if (raw) {
      const [at, id] = Buffer.from(raw, 'base64url').toString().split('|');
      if (!at || !id || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/i.test(id)) fail(400, 'Curseur invalide');
      after = { at, id };
    }
    const circle = [me.id, ...(await friendIds(me.id))];
    const c = uuidArray(circle);
    const items = await selectPosts(me.id, {
      where: sql`p.author_id = any(${c}) or exists(select 1 from reposts r where r.post_id = p.id and r.user_id = any(${c}))`,
      circle,
      limit: PAGE,
      after,
    });
    const last = items[items.length - 1];
    return { items, next: items.length === PAGE && last?.sortAt ? Buffer.from(`${last.sortAt}|${last.id}`).toString('base64url') : null };
  });

  app.get('/api/reels', async (req): Promise<Page<Post>> => {
    const me = requireUser(req);
    const page = pageOf(req);
    const circle = uuidArray([me.id, ...(await friendIds(me.id))]);
    const items = await selectPosts(me.id, {
      where: sql`p.kind = 'video' and p.author_id = any(${circle}) and coalesce(m.status, 'ready') <> 'processing'`,
      limit: PAGE,
      offset: page * PAGE,
    });
    return { items, next: items.length === PAGE ? page + 1 : null };
  });

  app.get('/api/memes', async (req) => {
    const me = requireUser(req);
    const page = pageOf(req);
    const podium =
      page === 0
        ? await selectPosts(me.id, {
            where: sql`p.kind = 'meme'`,
            orderBy: sql`likes desc, p.created_at asc`,
            limit: 3,
          })
        : [];
    const items = await selectPosts(me.id, { where: sql`p.kind = 'meme'`, limit: 24, offset: page * 24 });
    return { podium, items, next: items.length === 24 ? page + 1 : null };
  });

  app.post('/api/posts', async (req) => {
    const me = requireUser(req);
    const body = parse(createSchema, req.body);

    if (body.kind === 'photo' || body.kind === 'video') {
      const [m] = await db.select().from(media).where(eq(media.id, body.mediaId)).limit(1);
      if (!m || m.ownerId !== me.id) fail(400, 'Média introuvable');
      if (m!.kind !== (body.kind === 'photo' ? 'image' : 'video')) fail(400, body.kind === 'photo' ? 'Ce fichier n’est pas une photo' : 'Ce fichier n’est pas une vidéo');
      const [p] = await db
        .insert(posts)
        .values({ authorId: me.id, kind: body.kind, text: body.text, mediaId: body.mediaId, location: body.location || null })
        .returning();
      if (body.pool) await upsertPoolItem({ mediaId: body.mediaId, ownerId: me.id, addedById: me.id, scope: body.pool });
      await notifyMentions(me, body.text, { postId: p.id, kind: p.kind, where: 'post', id: p.id });
      return getPost(me.id, p.id);
    }

    // Sondage
    let options = body.options.filter((o) => o.label || o.mediaId);
    if (body.pollKind === 'text') {
      options = options.filter((o) => o.label);
      if (options.length < 2) fail(400, 'Ajoute au moins deux options');
      if (new Set(options.map((o) => o.label.toLowerCase())).size !== options.length) fail(400, 'Deux options sont identiques');
    } else if (body.pollKind === 'image') {
      if (options.length !== 2 || options.some((o) => !o.mediaId)) fail(400, 'Ajoute une photo pour chaque option');
      const ids = options.map((o) => o.mediaId!);
      const owned = await db.select({ id: media.id }).from(media).where(and(inArray(media.id, ids), eq(media.ownerId, me.id)));
      if (owned.length !== new Set(ids).size) fail(400, 'Média introuvable');
    } else {
      options = [];
    }
    const pollEndsAt = body.durationHours ? new Date(Date.now() + body.durationHours * 3600_000) : null;
    const [p] = await db
      .insert(posts)
      .values({ authorId: me.id, kind: 'poll', pollKind: body.pollKind, text: body.text, pollEndsAt, pollPublic: body.isPublic })
      .returning();
    await notifyMentions(me, body.text, { postId: p.id, kind: 'poll', where: 'post', id: p.id });
    if (options.length) {
      await db.insert(pollOptions).values(
        options.map((o, i) => ({ postId: p.id, label: o.label || `Option ${i + 1}`, mediaId: o.mediaId ?? null, position: i })),
      );
    }
    return getPost(me.id, p.id);
  });

  app.get('/api/posts/:id', async (req) => {
    const me = requireUser(req);
    const post = await getPost(me.id, uuidParam(req.params));
    if (!post) fail(404, 'Post introuvable');
    return post;
  });

  /** Modifier la légende de son post (photo, vidéo). Seules les nouvelles @mentions sont notifiées. */
  app.patch('/api/posts/:id', async (req) => {
    const me = requireUser(req);
    const id = uuidParam(req.params);
    const { text } = parse(z.object({ text: z.string().trim().max(280) }), req.body);
    const [p] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!p || p.authorId !== me.id) return fail(404, 'Post introuvable');
    if (p.kind !== 'photo' && p.kind !== 'video') fail(400, 'Seules les légendes des photos et vidéos se modifient');
    if (p.text !== text) {
      await db.update(posts).set({ text, editedAt: new Date() }).where(eq(posts.id, id));
      const before = new Set(extractMentions(p.text));
      const added = extractMentions(text).filter((u) => !before.has(u));
      if (added.length) await notifyMentions(me, added.map((u) => `@${u}`).join(' '), { postId: id, kind: p.kind, where: 'post', id: `${id}:${Date.now()}` });
    }
    return getPost(me.id, id);
  });

  app.delete('/api/posts/:id', async (req) => {
    const me = requireUser(req);
    const id = uuidParam(req.params);
    const p = await postAuthor(id);
    if (p.authorId !== me.id && !me.isAdmin) fail(403, 'Tu ne peux supprimer que tes posts');
    await db.delete(posts).where(eq(posts.id, id));
    return { ok: true };
  });

  // ——— Réactions ———

  app.put('/api/posts/:id/like', async (req) => {
    const me = requireUser(req);
    const id = uuidParam(req.params);
    const p = await visiblePost(me.id, id);
    const ins = await db.insert(likes).values({ postId: id, userId: me.id }).onConflictDoNothing().returning();
    if (ins.length) {
      await notify({ userId: p.authorId, type: 'like', actorId: me.id, data: { postId: id, kind: p.kind }, dedupeKey: `like:${id}:${me.id}` });
    }
    return { ok: true };
  });

  /** Réaction emoji (appui long sur le cœur) : une par personne, modifiable. */
  app.put('/api/posts/:id/reaction', async (req) => {
    const me = requireUser(req);
    const id = uuidParam(req.params);
    const { emoji } = parse(z.object({ emoji: z.enum(REACTIONS) }), req.body);
    const p = await visiblePost(me.id, id);
    const [before] = await db.select().from(postReactions).where(and(eq(postReactions.postId, id), eq(postReactions.userId, me.id))).limit(1);
    await db
      .insert(postReactions)
      .values({ postId: id, userId: me.id, emoji })
      .onConflictDoUpdate({ target: [postReactions.postId, postReactions.userId], set: { emoji, createdAt: new Date() } });
    if (!before && p.authorId !== me.id) {
      // Une seule notification par post, mise à jour à chaque nouvelle réaction.
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(postReactions).where(eq(postReactions.postId, id));
      await notify({
        userId: p.authorId,
        type: 'reaction',
        actorId: me.id,
        data: { postId: id, kind: p.kind, emoji, others: n - 1 },
        dedupeKey: `reaction:${id}`,
        push: n === 1 ? { title: me.displayName, body: `a réagi ${emoji} à ${KIND_LABEL[p.kind] ?? 'ton post'}`, url: `/p/${id}`, tag: `reaction:${id}` } : null,
      });
    }
    return reactionsOf(id, me.id);
  });

  app.delete('/api/posts/:id/reaction', async (req) => {
    const me = requireUser(req);
    const id = uuidParam(req.params);
    await db.delete(postReactions).where(and(eq(postReactions.postId, id), eq(postReactions.userId, me.id)));
    return reactionsOf(id, me.id);
  });

  app.delete('/api/posts/:id/like', async (req) => {
    const me = requireUser(req);
    const id = uuidParam(req.params);
    await db.delete(likes).where(and(eq(likes.postId, id), eq(likes.userId, me.id)));
    return { ok: true };
  });

  app.put('/api/posts/:id/repost', async (req) => {
    const me = requireUser(req);
    const id = uuidParam(req.params);
    const p = await visiblePost(me.id, id);
    if (p.authorId === me.id) fail(400, 'Tu ne peux pas republier ton propre post');
    const ins = await db.insert(reposts).values({ postId: id, userId: me.id }).onConflictDoNothing().returning();
    if (ins.length) {
      await notify({ userId: p.authorId, type: 'repost', actorId: me.id, data: { postId: id, kind: p.kind }, dedupeKey: `repost:${id}:${me.id}` });
    }
    return { ok: true };
  });

  app.delete('/api/posts/:id/repost', async (req) => {
    const me = requireUser(req);
    const id = uuidParam(req.params);
    await db.delete(reposts).where(and(eq(reposts.postId, id), eq(reposts.userId, me.id)));
    return { ok: true };
  });

  app.post('/api/posts/:id/vote', async (req) => {
    const me = requireUser(req);
    const id = uuidParam(req.params);
    const body = parse(z.object({ optionId: z.string().uuid().optional(), value: z.number().int().min(0).max(100).optional() }), req.body);
    await visiblePost(me.id, id);
    const [p] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!p || p.kind !== 'poll') return fail(404, 'Sondage introuvable');
    if (p.pollEndsAt && p.pollEndsAt <= new Date()) fail(409, 'Ce sondage est terminé');
    if (p.pollKind === 'slider') {
      if (body.value === undefined) fail(400, 'Valeur manquante');
    } else {
      const [o] = body.optionId
        ? await db.select().from(pollOptions).where(and(eq(pollOptions.id, body.optionId), eq(pollOptions.postId, id))).limit(1)
        : [];
      if (!o) fail(400, 'Option invalide');
    }
    const values = { postId: id, userId: me.id, optionId: body.optionId ?? null, value: body.value ?? null };
    await db
      .insert(pollVotes)
      .values(values)
      .onConflictDoUpdate({ target: [pollVotes.postId, pollVotes.userId], set: { optionId: values.optionId, value: values.value } });
    const polls = await loadPolls(me.id, [{ id, kind: p.pollKind ?? 'text', endsAt: p.pollEndsAt, isPublic: p.pollPublic }]);
    return polls.get(id);
  });

  // ——— Commentaires ———

  app.get('/api/posts/:id/comments', async (req): Promise<Comment[]> => {
    const me = requireUser(req);
    const id = uuidParam(req.params);
    await visiblePost(me.id, id);
    const rows = await db.execute<{ id: string; authorId: string; text: string; createdAt: Date; likes: number; liked: boolean }>(sql`
      select c.id, c.author_id as "authorId", c.text, c.created_at as "createdAt",
        (select count(*)::int from comment_likes cl where cl.comment_id = c.id) as likes,
        exists(select 1 from comment_likes cl where cl.comment_id = c.id and cl.user_id = ${me.id}) as liked
      from comments c where c.post_id = ${id}
        and (c.hidden_at is null or c.author_id = ${me.id})
        and ${notBlocked(me.id, sql`c.author_id`)}
      order by c.created_at asc limit 300`);
    const list = [...rows];
    const authors = await usersByIds(list.map((r) => r.authorId));
    return list.map((r) => ({
      id: r.id,
      postId: id,
      author: authors.get(r.authorId)!,
      text: r.text,
      createdAt: new Date(r.createdAt).toISOString(),
      likes: r.likes,
      liked: r.liked,
    }));
  });

  app.post('/api/posts/:id/comments', async (req): Promise<Comment> => {
    const me = requireUser(req);
    const id = uuidParam(req.params);
    const { text } = parse(z.object({ text: z.string().trim().min(1, 'Commentaire vide').max(200) }), req.body);
    const p = await visiblePost(me.id, id);
    const [c] = await db.insert(comments).values({ postId: id, authorId: me.id, text }).returning();
    await notify({
      userId: p.authorId,
      type: 'comment',
      actorId: me.id,
      data: { postId: id, kind: p.kind, text: text.slice(0, 80) },
      push: { title: me.displayName, body: `a commenté ${KIND_LABEL[p.kind] ?? 'ton post'} : ${text.slice(0, 80)}`, url: `/p/${id}`, tag: `comment:${id}` },
    });
    await notifyMentions(me, text, { postId: id, kind: p.kind, where: 'comment', id: c.id, postAuthorId: p.authorId });
    const authors = await usersByIds([me.id]);
    return { id: c.id, postId: id, author: authors.get(me.id)!, text: c.text, createdAt: c.createdAt.toISOString(), likes: 0, liked: false };
  });

  app.delete('/api/comments/:id', async (req) => {
    const me = requireUser(req);
    const id = uuidParam(req.params);
    const [c] = await db.select().from(comments).where(eq(comments.id, id)).limit(1);
    if (!c) return fail(404, 'Commentaire introuvable');
    if (c.authorId !== me.id && !me.isAdmin) fail(403, 'Action impossible');
    await db.delete(comments).where(eq(comments.id, id));
    return { ok: true };
  });

  app.put('/api/comments/:id/like', async (req) => {
    const me = requireUser(req);
    const id = uuidParam(req.params);
    await db.insert(commentLikes).values({ commentId: id, userId: me.id }).onConflictDoNothing();
    return { ok: true };
  });

  app.delete('/api/comments/:id/like', async (req) => {
    const me = requireUser(req);
    const id = uuidParam(req.params);
    await db.delete(commentLikes).where(and(eq(commentLikes.commentId, id), eq(commentLikes.userId, me.id)));
    return { ok: true };
  });
}
