// Types et constantes partagés entre le serveur et la PWA.

export type ID = string;

/** 0 = bleu clair (tint), 1 = encre, 2 = bleu vif — palette d'avatars de la maquette. */
export type AvatarTone = 0 | 1 | 2;

export interface UserLite {
  id: ID;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  initials: string;
  tone: AvatarTone;
}

export interface Me extends UserLite {
  email: string;
  city: string | null;
  bio: string | null;
  isAdmin: boolean;
  createdAt: string;
}

export type Friendship = 'self' | 'none' | 'pending_out' | 'pending_in' | 'friends';

export interface StreakInfo {
  /** Nombre de semaines consécutives avec au moins une photo dans la Pellicule. */
  weeks: number;
  /** 8 dernières semaines, de la plus ancienne à la semaine en cours. */
  history: boolean[];
}

export interface UserProfile extends UserLite {
  city: string | null;
  bio: string | null;
  stats: { posts: number; friends: number; memesWon: number };
  streak: StreakInfo;
  friendship: Friendship;
}

export interface UserSearchResult extends UserLite {
  friendship: Friendship;
}

export interface FriendsList {
  friends: UserLite[];
  incoming: UserLite[];
  outgoing: UserLite[];
}

export interface MediaRef {
  id: ID;
  url: string;
  kind: 'image' | 'video';
  width: number | null;
  height: number | null;
  /** Miniature (vidéos). */
  poster: string | null;
  /** Durée en secondes (vidéos). */
  duration: number | null;
  /** Vidéo en cours de transcodage. */
  processing: boolean;
}

export type PostKind = 'photo' | 'video' | 'poll' | 'meme';
export type PollKind = 'text' | 'image' | 'slider';
export type PoolScope = 'public' | 'friends';

export interface PollOption {
  id: ID;
  label: string;
  media: MediaRef | null;
  votes: number;
}

export interface Poll {
  kind: PollKind;
  options: PollOption[];
  total: number;
  myVote: ID | null;
  /** Valeur 0–100 pour un sondage curseur. */
  myValue: number | null;
  /** Moyenne 0–100 pour un sondage curseur. */
  average: number | null;
}

export interface Post {
  id: ID;
  kind: PostKind;
  author: UserLite;
  text: string;
  media: MediaRef | null;
  location: string | null;
  createdAt: string;
  likes: number;
  comments: number;
  reposts: number;
  liked: boolean;
  reposted: boolean;
  pool: PoolScope | null;
  repostedBy: UserLite | null;
  poll: Poll | null;
}

export interface Page<T> {
  items: T[];
  next: number | null;
}

export interface Comment {
  id: ID;
  postId: ID;
  author: UserLite;
  text: string;
  createdAt: string;
  likes: number;
  liked: boolean;
}

export interface Story {
  id: ID;
  media: MediaRef;
  createdAt: string;
  seen: boolean;
}

export interface StoryGroup {
  user: UserLite;
  stories: Story[];
  allSeen: boolean;
}

export interface PoolStats {
  publicCount: number;
  mine: number;
}

// ——— Pellicule ———

export interface MomentInfo {
  at: string;
  endsAt: string;
}

export interface PelliculeState {
  nextRevealAt: string;
  weekLabel: string;
  /** « Moment Mandrix » en cours (10 minutes pour prendre sa photo). */
  moment: MomentInfo | null;
  mine: { total: number; days: number[] };
  current: { count: number; people: number };
  streak: StreakInfo;
}

export interface Shot {
  id: ID;
  media: MediaRef;
  author: UserLite;
  day: string;
  takenAt: string;
  likes: number;
  liked: boolean;
  pool: PoolScope | null;
  /** Prise pendant le « Moment Mandrix ». */
  onTime: boolean;
}

export interface UnpackState {
  nextRevealAt: string;
  current: { count: number; people: number; weekLabel: string };
  /** Dernier déballage ouvert (null tant qu'aucun dimanche n'est passé). */
  revealed: {
    revealAt: string;
    weekLabel: string;
    count: number;
    people: number;
    busiestDay: string | null;
    photos: Shot[];
    top: Shot[];
  } | null;
}

// ——— Messages ———

export type MessageMeta =
  | { type: 'game_invite'; code: string }
  /** Réponse à une story : la photo (ou vidéo) concernée est gardée pour l'afficher dans la conversation. */
  | { type: 'story_reply'; storyId: ID; media?: MediaRef | null }
  /** Évènement de groupe (création, ajout, départ, renommage), affiché au centre. */
  | { type: 'system' }
  | null;

export interface Message {
  id: ID;
  conversationId: ID;
  senderId: ID;
  text: string;
  meta: MessageMeta;
  createdAt: string;
}

export interface Conversation {
  id: ID;
  isGroup: boolean;
  /** Nom du groupe (null : on affiche les prénoms des membres). */
  title: string | null;
  /** Interlocuteur d'une conversation à deux. */
  user: UserLite | null;
  /** Autres membres (sans moi). */
  members: UserLite[];
  last: { text: string; at: string; mine: boolean; sender: string | null; system: boolean } | null;
  unread: boolean;
}

export interface ConversationDetail {
  id: ID;
  isGroup: boolean;
  title: string | null;
  user: UserLite | null;
  /** Tous les membres, moi compris. */
  members: UserLite[];
  createdBy: ID | null;
}

export const GROUP_MAX_MEMBERS = 20;

/** Nom affiché d'une conversation : titre du groupe, sinon prénoms des membres. */
export function conversationName(c: { isGroup: boolean; title: string | null; user: UserLite | null; members: UserLite[] }, meId?: ID): string {
  if (!c.isGroup) return c.user?.displayName ?? 'Conversation';
  if (c.title) return c.title;
  const names = c.members.filter((m) => m.id !== meId).map((m) => m.displayName.split(' ')[0]);
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ') || 'Groupe';
}

// ——— Notifications ———

export type NotificationType =
  | 'like'
  | 'comment'
  | 'repost'
  | 'friend_request'
  | 'friend_accept'
  | 'game_invite'
  | 'unpack'
  | 'pool_added'
  | 'pool_drawn'
  | 'streak'
  | 'shot_like'
  | 'invite_joined'
  | 'moment';

export interface AppNotification {
  id: ID;
  type: NotificationType;
  actor: UserLite | null;
  data: Record<string, unknown>;
  createdAt: string;
  read: boolean;
}

export interface Badges {
  notifications: number;
  messages: number;
}

export interface AppConfig {
  inviteRequired: boolean;
  mailEnabled: boolean;
  vapidPublicKey: string | null;
  revealDay: number;
  revealHour: number;
  roundSeconds: number;
  maxUploadMb: number;
}

export interface InviteInfo {
  code: string;
  link: string;
  invited: number;
}

export interface ReportedItem {
  id: ID;
  media: MediaRef;
  owner: UserLite;
  reports: number;
  createdAt: string;
}

// ——— Make It Friends ———

export const GAME = {
  maxPlayers: 8,
  minPlayers: 2,
  roundOptions: [3, 5, 7] as const,
  shufflesPerRound: 3,
  voteSecondsPerMeme: 12,
  captionMax: 90,
  ratings: [
    { value: 0, label: 'Bof', points: 10 },
    { value: 1, label: 'Drôle', points: 50 },
    { value: 2, label: 'Légendaire', points: 100 },
  ],
} as const;

export type GameStage = 'lobby' | 'caption' | 'vote' | 'results' | 'final';
export type GameSource = 'public' | 'friends';

export interface PoolImage {
  itemId: ID;
  media: MediaRef;
  by: string;
}

export interface GamePlayer {
  user: UserLite;
  score: number;
  roundScore: number;
  connected: boolean;
  submitted: boolean;
  voted: boolean;
}

export interface GameMeme {
  id: ID;
  image: PoolImage;
  caption: string;
  author: UserLite;
  mine: boolean;
  myRating: number | null;
  score: number;
}

export interface GameRoom {
  code: string;
  hostId: ID;
  players: GamePlayer[];
  rounds: number;
  source: GameSource;
  seconds: number;
  stage: GameStage;
  round: number;
  deadline: string | null;
  me: { image: PoolImage | null; caption: string | null; shufflesLeft: number; memeId: ID | null; published: boolean };
  /** Mèmes à noter (vote) ou de la manche (results). */
  memes: GameMeme[];
  winner: GameMeme | null;
  error: string | null;
}

export type Ack<T = undefined> = (res: { ok: true; data?: T } | { ok: false; error: string }) => void;

export interface ServerToClientEvents {
  'game:state': (room: GameRoom | null) => void;
  'notif:new': (n: AppNotification) => void;
  'dm:new': (m: Message) => void;
  badges: (b: Badges) => void;
  'media:ready': (mediaId: ID) => void;
}

export interface ClientToServerEvents {
  'game:create': (ack: Ack<GameRoom>) => void;
  'game:join': (code: string, ack: Ack<GameRoom>) => void;
  'game:leave': (ack: Ack) => void;
  'game:sync': (ack: Ack<GameRoom | null>) => void;
  'game:settings': (s: { rounds?: number; source?: GameSource }, ack: Ack) => void;
  'game:start': (ack: Ack) => void;
  'game:shuffle': (ack: Ack) => void;
  'game:report': (ack: Ack) => void;
  'game:caption': (text: string, ack: Ack) => void;
  'game:rate': (memeId: ID, rating: number, ack: Ack) => void;
  'game:next': (ack: Ack) => void;
  'game:publish': (ack: Ack) => void;
}

// ——— Utilitaires ———

export const USERNAME_RE = /^[a-z0-9._]{3,20}$/;

export function initialsOf(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function toneOf(id: string): AvatarTone {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 3) as AvatarTone;
}

export const DAY_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
