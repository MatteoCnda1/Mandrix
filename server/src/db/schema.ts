import type { NotificationPrefs } from '@mandrix/shared';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const created = () => ts('created_at').defaultNow().notNull();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  avatarMediaId: uuid('avatar_media_id'),
  city: text('city'),
  bio: text('bio'),
  isAdmin: boolean('is_admin').default(false).notNull(),
  /** Code de parrainage personnel, à partager pour inviter des amis. */
  inviteCode: text('invite_code').unique(),
  /** Parrain : membre dont le code a servi à l'inscription. */
  invitedBy: uuid('invited_by'),
  /** Préférences de notifications (types coupés, heures calmes). */
  notificationPrefs: jsonb('notification_prefs').$type<NotificationPrefs>().notNull().default({}),
  /** Compte suspendu par un admin : connexion refusée. */
  suspendedAt: ts('suspended_at'),
  /** Dernière déconnexion de l'app (présence « actif il y a … »). */
  lastSeenAt: ts('last_seen_at'),
  /** Montrer sa présence (sinon, on ne voit pas non plus celle des autres). */
  showPresence: boolean('show_presence').notNull().default(true),
  /** Anniversaire « MM-JJ » (l'année n'est pas demandée). */
  birthday: text('birthday'),
  /** Post épinglé en tête du profil. */
  pinnedPostId: uuid('pinned_post_id'),
  createdAt: created(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: created(),
  expiresAt: ts('expires_at').notNull(),
  userAgent: text('user_agent'),
  lastSeenAt: ts('last_seen_at'),
});

export const passwordResets = pgTable('password_resets', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: ts('expires_at').notNull(),
  used: boolean('used').default(false).notNull(),
});

export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'image' | 'video' | 'audio'>().notNull(),
    mime: text('mime').notNull(),
    path: text('path').notNull(),
    width: integer('width'),
    height: integer('height'),
    size: integer('size').notNull(),
    /** Média scellé (photo de la Pellicule) : inaccessible avant cette date. */
    sealedUntil: ts('sealed_until'),
    /** Vidéos : « processing » pendant le transcodage, puis « ready » (ou « failed »). */
    status: text('status').$type<'ready' | 'processing' | 'failed'>().notNull().default('ready'),
    /** Fichier d'origine en attente de transcodage. */
    sourcePath: text('source_path'),
    /** Miniature WebP d'une vidéo. */
    posterPath: text('poster_path'),
    /** Durée d'une vidéo, en secondes. */
    duration: real('duration'),
    /** Largeurs des variantes WebP réduites d'une photo (ex. [320, 720]). */
    variants: jsonb('variants').$type<number[]>(),
    createdAt: created(),
  },
  (t) => [index('media_owner_idx').on(t.ownerId), index('media_status_idx').on(t.status)],
);

export const friendships = pgTable(
  'friendships',
  {
    requesterId: uuid('requester_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    addresseeId: uuid('addressee_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').$type<'pending' | 'accepted'>().notNull().default('pending'),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.requesterId, t.addresseeId] }), index('friend_addressee_idx').on(t.addresseeId)],
);

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'photo' | 'video' | 'poll' | 'meme'>().notNull(),
    pollKind: text('poll_kind').$type<'text' | 'image' | 'slider'>(),
    text: text('text').notNull().default(''),
    mediaId: uuid('media_id').references(() => media.id, { onDelete: 'set null' }),
    location: text('location'),
    /** Sondage : fin des votes (null : sans fin). */
    pollEndsAt: ts('poll_ends_at'),
    /** Sondage : les votes de chacun sont visibles. */
    pollPublic: boolean('poll_public').notNull().default(false),
    /** Sondage : l'auteur a été prévenu de la fin. */
    pollNotifiedAt: ts('poll_notified_at'),
    /** Masqué après plusieurs signalements ou par un admin. */
    hiddenAt: ts('hidden_at'),
    /** Légende modifiée par l'auteur. */
    editedAt: ts('edited_at'),
    createdAt: created(),
  },
  (t) => [index('posts_author_idx').on(t.authorId, t.createdAt), index('posts_kind_idx').on(t.kind, t.createdAt)],
);

export const pollOptions = pgTable(
  'poll_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    mediaId: uuid('media_id').references(() => media.id, { onDelete: 'set null' }),
    position: integer('position').notNull(),
  },
  (t) => [index('poll_options_post_idx').on(t.postId)],
);

export const pollVotes = pgTable(
  'poll_votes',
  {
    postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    optionId: uuid('option_id').references(() => pollOptions.id, { onDelete: 'cascade' }),
    value: integer('value'),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
);

export const likes = pgTable(
  'likes',
  {
    postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
);

/** Photos supplémentaires d'un post (carrousel) ; la première reste dans posts.media_id. */
export const postMedia = pgTable(
  'post_media',
  {
    postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id').notNull().references(() => media.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.position] }), index('post_media_media_idx').on(t.mediaId)],
);

export const postReactions = pgTable(
  'post_reactions',
  {
    postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
);

export const reposts = pgTable(
  'reposts',
  {
    postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] }), index('reposts_user_idx').on(t.userId)],
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    /** Réponse à un commentaire (un seul niveau). */
    parentId: uuid('parent_id'),
    hiddenAt: ts('hidden_at'),
    createdAt: created(),
  },
  (t) => [index('comments_post_idx').on(t.postId, t.createdAt)],
);

export const commentLikes = pgTable(
  'comment_likes',
  {
    commentId: uuid('comment_id').notNull().references(() => comments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.userId] })],
);

export const stories = pgTable(
  'stories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id').notNull().references(() => media.id, { onDelete: 'cascade' }),
    hiddenAt: ts('hidden_at'),
    createdAt: created(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [index('stories_author_idx').on(t.authorId, t.expiresAt)],
);

export const storyViews = pgTable(
  'story_views',
  {
    storyId: uuid('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
    viewerId: uuid('viewer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    viewedAt: ts('viewed_at').defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.storyId, t.viewerId] })],
);

export const shots = pgTable(
  'shots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id').notNull().references(() => media.id, { onDelete: 'cascade' }),
    takenAt: ts('taken_at').defaultNow().notNull(),
    revealAt: ts('reveal_at').notNull(),
    /** Identifiant généré par l'appareil : évite les doublons lors des envois différés. */
    clientId: text('client_id'),
    /** Photo prise dans les 10 minutes du « Moment Mandrix ». */
    onTime: boolean('on_time').notNull().default(false),
  },
  (t) => [
    index('shots_reveal_idx').on(t.revealAt),
    index('shots_user_idx').on(t.userId, t.revealAt),
    uniqueIndex('shots_client_idx').on(t.userId, t.clientId),
  ],
);

export const shotLikes = pgTable(
  'shot_likes',
  {
    shotId: uuid('shot_id').notNull().references(() => shots.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.shotId, t.userId] })],
);

/** « Qui a pris ça ? » : une réponse par photo et par joueur. */
export const shotGuesses = pgTable(
  'shot_guesses',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    shotId: uuid('shot_id').notNull().references(() => shots.id, { onDelete: 'cascade' }),
    guessedId: uuid('guessed_id').references(() => users.id, { onDelete: 'set null' }),
    correct: boolean('correct').notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.shotId] })],
);

/** « Qui a pris ça ? » : partie d'une semaine (finie ou passée) et ses points. */
export const guessRounds = pgTable(
  'guess_rounds',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    revealAt: ts('reveal_at').notNull(),
    status: text('status').$type<'done' | 'skipped'>().notNull(),
    score: integer('score').notNull().default(0),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.revealAt] }), index('guess_rounds_created_idx').on(t.createdAt)],
);

/** « Qui de nous… ? » : questions écrites par les joueurs. */
export const whoisQuestions = pgTable(
  'whois_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    createdAt: created(),
  },
  (t) => [index('whois_questions_author_idx').on(t.authorId)],
);

export const poolItems = pgTable(
  'pool_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mediaId: uuid('media_id').notNull().unique().references(() => media.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    addedById: uuid('added_by_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    scope: text('scope').$type<'public' | 'friends'>().notNull(),
    status: text('status').$type<'active' | 'reported' | 'removed'>().notNull().default('active'),
    draws: integer('draws').notNull().default(0),
    createdAt: created(),
  },
  (t) => [index('pool_status_idx').on(t.status, t.scope)],
);

export const poolReports = pgTable(
  'pool_reports',
  {
    itemId: uuid('item_id').notNull().references(() => poolItems.id, { onDelete: 'cascade' }),
    reporterId: uuid('reporter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.reporterId] })],
);

export const memes = pgTable(
  'memes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id').notNull().references(() => media.id, { onDelete: 'cascade' }),
    caption: text('caption').notNull(),
    score: integer('score').notNull().default(0),
    isWinner: boolean('is_winner').notNull().default(false),
    gameCode: text('game_code').notNull(),
    round: integer('round').notNull(),
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'set null' }),
    createdAt: created(),
  },
  (t) => [index('memes_author_idx').on(t.authorId)],
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Conversations à deux uniquement (paire triée) ; null pour les groupes. */
    userA: uuid('user_a').references(() => users.id, { onDelete: 'cascade' }),
    userB: uuid('user_b').references(() => users.id, { onDelete: 'cascade' }),
    isGroup: boolean('is_group').notNull().default(false),
    title: text('title'),
    /** Photo du groupe (média de l'API). */
    photoMediaId: uuid('photo_media_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    lastMessageAt: ts('last_message_at').defaultNow().notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex('conversations_pair_idx').on(t.userA, t.userB), index('conversations_b_idx').on(t.userB)],
);

export const conversationMembers = pgTable(
  'conversation_members',
  {
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: created(),
    /** Conversation en sourdine : pas de notification push. */
    muted: boolean('muted').notNull().default(false),
    /** Épinglée en haut de la liste (date d'épinglage). */
    pinnedAt: ts('pinned_at'),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] }), index('conversation_members_user_idx').on(t.userId)],
);

export const conversationReads = pgTable(
  'conversation_reads',
  {
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    lastReadAt: ts('last_read_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] })],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    meta: jsonb('meta'),
    /** Pièce jointe : photo, vidéo ou message vocal. */
    mediaId: uuid('media_id').references(() => media.id, { onDelete: 'set null' }),
    /** Supprimé pour tout le monde par son auteur (texte et pièce jointe effacés). */
    deletedAt: ts('deleted_at'),
    /** Identifiant d'envoi choisi par l'app : un renvoi (file hors ligne) ne crée pas de doublon. */
    clientId: text('client_id'),
    createdAt: created(),
  },
  (t) => [index('messages_conv_idx').on(t.conversationId, t.createdAt), uniqueIndex('messages_client_idx').on(t.senderId, t.clientId)],
);

export const messageReactions = pgTable(
  'message_reactions',
  {
    messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId] })],
);

/** Blocage : plus de visibilité réciproque ni de contact. */
export const blocks = pgTable(
  'blocks',
  {
    blockerId: uuid('blocker_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index('blocks_blocked_idx').on(t.blockedId)],
);

/** Signalements de posts, commentaires, stories, messages et comptes. */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterId: uuid('reporter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    targetType: text('target_type').$type<'post' | 'comment' | 'story' | 'message' | 'user'>().notNull(),
    targetId: uuid('target_id').notNull(),
    reason: text('reason').notNull(),
    resolvedAt: ts('resolved_at'),
    createdAt: created(),
  },
  (t) => [uniqueIndex('reports_unique').on(t.reporterId, t.targetType, t.targetId), index('reports_target_idx').on(t.targetType, t.targetId)],
);

/** Mème du jour : une image tirée du pool chaque matin. */
export const dailyMemes = pgTable('daily_memes', {
  day: date('day', { mode: 'string' }).primaryKey(),
  mediaId: uuid('media_id').notNull().references(() => media.id, { onDelete: 'cascade' }),
  closedAt: ts('closed_at'),
  createdAt: created(),
});

export const dailyCaptions = pgTable(
  'daily_captions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    day: date('day', { mode: 'string' }).notNull().references(() => dailyMemes.day, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    votes: integer('votes').notNull().default(0),
    createdAt: created(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [uniqueIndex('daily_captions_unique').on(t.day, t.userId)],
);

export const dailyVotes = pgTable(
  'daily_votes',
  {
    day: date('day', { mode: 'string' }).notNull().references(() => dailyMemes.day, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    captionId: uuid('caption_id').notNull().references(() => dailyCaptions.id, { onDelete: 'cascade' }),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.day, t.userId] })],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'cascade' }),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    dedupeKey: text('dedupe_key'),
    createdAt: created(),
    readAt: ts('read_at'),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.createdAt),
    uniqueIndex('notifications_dedupe_idx').on(t.userId, t.dedupeKey),
  ],
);

export const pushSubscriptions = pgTable('push_subscriptions', {
  endpoint: text('endpoint').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: created(),
});

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
