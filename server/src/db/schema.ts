import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
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
  createdAt: created(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: created(),
  expiresAt: ts('expires_at').notNull(),
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
    kind: text('kind').$type<'image' | 'video'>().notNull(),
    mime: text('mime').notNull(),
    path: text('path').notNull(),
    width: integer('width'),
    height: integer('height'),
    size: integer('size').notNull(),
    /** Média scellé (photo de la Pellicule) : inaccessible avant cette date. */
    sealedUntil: ts('sealed_until'),
    createdAt: created(),
  },
  (t) => [index('media_owner_idx').on(t.ownerId)],
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
  },
  (t) => [index('shots_reveal_idx').on(t.revealAt), index('shots_user_idx').on(t.userId, t.revealAt)],
);

export const shotLikes = pgTable(
  'shot_likes',
  {
    shotId: uuid('shot_id').notNull().references(() => shots.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.shotId, t.userId] })],
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
    userA: uuid('user_a').notNull().references(() => users.id, { onDelete: 'cascade' }),
    userB: uuid('user_b').notNull().references(() => users.id, { onDelete: 'cascade' }),
    lastMessageAt: ts('last_message_at').defaultNow().notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex('conversations_pair_idx').on(t.userA, t.userB), index('conversations_b_idx').on(t.userB)],
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
    createdAt: created(),
  },
  (t) => [index('messages_conv_idx').on(t.conversationId, t.createdAt)],
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
