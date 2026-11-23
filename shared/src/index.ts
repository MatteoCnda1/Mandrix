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
  /** C'est son anniversaire aujourd'hui (🎂). */
  birthdayToday?: boolean;
}

export interface Me extends UserLite {
  email: string;
  city: string | null;
  bio: string | null;
  isAdmin: boolean;
  createdAt: string;
  notificationPrefs: NotificationPrefs;
  showPresence: boolean;
  /** Anniversaire « MM-JJ ». */
  birthday: string | null;
  /** Post épinglé en tête de mon profil. */
  pinnedPostId: ID | null;
}

/** Présence d'un ami : en ligne, ou dernière activité. */
export interface Presence {
  online: boolean;
  lastSeenAt: string | null;
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
  /** Je bloque cette personne. */
  blockedByMe: boolean;
  /** Anniversaire « MM-JJ » (visible par ses amis). */
  birthday: string | null;
  /** Post épinglé en tête du profil. */
  pinnedPostId: ID | null;
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
  kind: 'image' | 'video' | 'audio';
  width: number | null;
  height: number | null;
  /** Miniature (vidéos). */
  poster: string | null;
  /** Durée en secondes (vidéos, vocaux). */
  duration: number | null;
  /** Vidéo en cours de transcodage. */
  processing: boolean;
  /** Photos : variantes réduites pour `srcset` (null si aucune). */
  srcSet: string | null;
}

export type PostKind = 'photo' | 'video' | 'poll' | 'meme';

/** Réactions proposées par un appui long (le tap reste le « j'aime »). */
export const REACTIONS = ['😂', '😍', '😮', '😢', '🔥', '👏'] as const;
/** Réactions des messages : le cœur en premier. */
export const MESSAGE_REACTIONS = ['❤️', ...REACTIONS] as const;

export interface ReactionCount {
  emoji: string;
  count: number;
}

export interface MessageReaction {
  emoji: string;
  userIds: ID[];
}
export type PollKind = 'text' | 'image' | 'slider';
export type PoolScope = 'public' | 'friends';

export interface PollOption {
  id: ID;
  label: string;
  media: MediaRef | null;
  votes: number;
  /** Qui a voté pour cette option (sondage public), sinon null. */
  voters: UserLite[] | null;
}

/** Durées proposées dans le composer (en heures ; null : sans fin). */
export const POLL_DURATIONS = [
  { hours: 1, label: '1 h' },
  { hours: 24, label: '24 h' },
  { hours: 72, label: '3 jours' },
  { hours: null, label: 'Sans fin' },
] as const;
export const POLL_MAX_OPTIONS = 6;

export interface Poll {
  kind: PollKind;
  options: PollOption[];
  total: number;
  myVote: ID | null;
  /** Valeur 0–100 pour un sondage curseur. */
  myValue: number | null;
  /** Moyenne 0–100 pour un sondage curseur. */
  average: number | null;
  /** Fin des votes (null : sans fin). */
  endsAt: string | null;
  /** Votes terminés : résultat figé. */
  closed: boolean;
  /** Les votes de chacun sont visibles. */
  isPublic: boolean;
  /** Sondage curseur public : la valeur de chacun. */
  sliderVotes: { user: UserLite; value: number }[] | null;
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
  /** Réactions emoji, les plus fréquentes d'abord. */
  reactions: ReactionCount[];
  myReaction: string | null;
  /** Légende modifiée après publication. */
  edited: boolean;
  /** Carrousel : toutes les photos du post (la première = media), null s'il n'y en a qu'une. */
  gallery: MediaRef[] | null;
  /** Date de tri dans le fil (curseur de pagination). */
  sortAt?: string;
}

export interface PostSearch {
  posts: Post[];
  users: UserLite[];
}

export interface FriendSuggestion {
  user: UserLite;
  mutual: number;
  /** Prénoms de quelques amis en commun. */
  via: string[];
}

export const MENTION_RE = /(^|[^\p{L}\p{N}_.])@([a-z0-9._]{3,20})/giu;
export const HASHTAG_RE = /(^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_]{2,40})/gu;

/** Pseudos mentionnés (@pseudo) dans un texte, sans doublon, en minuscules. */
export function extractMentions(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION_RE)].map((m) => m[2].toLowerCase().replace(/\.+$/, '')))].filter((u) => u.length >= 3);
}

/** Hashtags (#mot) d'un texte, sans doublon, en minuscules. */
export function extractHashtags(text: string): string[] {
  return [...new Set([...text.matchAll(HASHTAG_RE)].map((m) => m[2].toLowerCase()))];
}

export type TextPart =
  | { type: 'text'; value: string }
  | { type: 'mention'; username: string; value: string }
  | { type: 'hashtag'; tag: string; value: string }
  | { type: 'url'; href: string; value: string };

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;

/** Découpe un texte en morceaux (texte, lien, @mention, #hashtag) pour un rendu sans HTML injecté. */
export function splitRichText(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    // Ponctuation finale (fin de phrase) et parenthèse fermante orpheline : hors du lien.
    while (/[.,;:!?…]$/.test(url) || (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0))) url = url.slice(0, -1);
    const start = m.index!;
    if (start > last) parts.push(...splitTags(text.slice(last, start)));
    try {
      const href = new URL(url).href;
      parts.push({ type: 'url', href, value: url });
    } catch {
      parts.push({ type: 'text', value: url });
    }
    last = start + url.length;
  }
  if (last < text.length) parts.push(...splitTags(text.slice(last)));
  return parts;
}

function splitTags(text: string): TextPart[] {
  const re = new RegExp(`${MENTION_RE.source}|${HASHTAG_RE.source}`, 'giu');
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const lead = m[1] ?? m[3] ?? '';
    const start = m.index! + lead.length;
    if (start > last) parts.push({ type: 'text', value: text.slice(last, start) });
    if (m[2]) {
      const username = m[2].toLowerCase().replace(/\.+$/, '');
      const value = `@${m[2].replace(/\.+$/, '')}`;
      parts.push({ type: 'mention', username, value });
      last = start + value.length;
    } else {
      parts.push({ type: 'hashtag', tag: m[4].toLowerCase(), value: `#${m[4]}` });
      last = start + 1 + m[4].length;
    }
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts;
}

export interface Page<T> {
  items: T[];
  /** Page suivante : numéro, ou curseur opaque (fil). */
  next: number | string | null;
}

export interface Comment {
  id: ID;
  postId: ID;
  author: UserLite;
  text: string;
  createdAt: string;
  likes: number;
  liked: boolean;
  /** Réponse à ce commentaire (un seul niveau de réponses). */
  parentId: ID | null;
}

/** Posts d'un profil : le post épinglé à part, en tête. */
export interface ProfilePosts {
  items: Post[];
  next: number | null;
  locked: boolean;
  pinned: Post | null;
}

export interface Story {
  id: ID;
  media: MediaRef;
  createdAt: string;
  seen: boolean;
  /** Mes stories : nombre de vues (null pour celles des autres). */
  views: number | null;
}

export interface StoryView {
  user: UserLite;
  at: string;
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
  /** Dernière photo encore annulable (quelques minutes après la prise). */
  undo: { shotId: ID; until: string } | null;
}

/** Délai pour annuler une photo de la Pellicule prise par erreur. */
export const SHOT_UNDO_MINUTES = 5;

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
    /**
     * « Qui a pris ça ? » : tant que le quiz est à faire (`todo`), les photos restent cachées
     * (photos et top vides) ; `none` : pas de quiz cette semaine.
     */
    quiz: GuessStatus;
  } | null;
}

// ——— Qui a pris ça ? ———

export const GUESS = { maxPhotos: 8, choices: 4, pointsPerHit: 20 } as const;

export type GuessStatus = 'none' | 'todo' | 'done' | 'skipped';

export interface GuessItem {
  shotId: ID;
  media: MediaRef;
  /** Visages proposés (l'auteur et d'autres participants de la semaine). */
  options: UserLite[];
  /** Ma réponse (null tant que je n'ai pas répondu). */
  myGuess: ID | null;
  /** Auteur, révélé une fois que j'ai répondu ou passé le quiz. */
  answer: UserLite | null;
}

export interface GuessState {
  revealAt: string;
  weekLabel: string;
  status: GuessStatus;
  items: GuessItem[];
  /** Mes points de la semaine. */
  score: number;
  /** Classement de la semaine parmi ceux qui ont joué. */
  ranking: { user: UserLite; score: number; hits: number }[];
}

// ——— Messages ———

export type MessageMeta =
  | { type: 'game_invite'; code: string }
  /** Réponse à une story : la photo (ou vidéo) concernée est gardée pour l'afficher dans la conversation. */
  | { type: 'story_reply'; storyId: ID; media?: MediaRef | null }
  /** Évènement de groupe (création, ajout, départ, renommage), affiché au centre. */
  | { type: 'system' }
  /** Réponse à un message (glisser la bulle) : extrait du message d'origine. */
  | { type: 'reply'; replyTo: ReplyQuote }
  /** Post partagé : aperçu à jour (null si le post a été supprimé ou masqué). */
  | { type: 'post_share'; postId: ID; post: SharedPost | null }
  | null;

export interface SharedPost {
  id: ID;
  kind: PostKind;
  author: UserLite;
  text: string;
  media: MediaRef | null;
}

export const SHARED_POST_LABEL = '↗️ Post partagé';

/** Réponse au partage d'un post : conversations servies, et personnes qui ne peuvent pas le voir. */
export interface ShareResult {
  sent: ID[];
  refused: string[];
}

export interface ReplyQuote {
  id: ID;
  senderId: ID;
  /** Texte d'origine (raccourci) ou libellé de la pièce jointe. */
  text: string;
}

export interface Message {
  id: ID;
  conversationId: ID;
  senderId: ID;
  text: string;
  meta: MessageMeta;
  /** Pièce jointe : photo, vidéo ou message vocal (kind « audio »). */
  media: MediaRef | null;
  reactions: MessageReaction[];
  /** Supprimé pour tout le monde par son auteur. */
  deleted: boolean;
  createdAt: string;
}

/** Libellé court d'une pièce jointe (aperçu de conversation, notification). */
export function attachmentLabel(kind: MediaRef['kind'] | null | undefined, duration?: number | null): string {
  if (kind === 'audio') {
    const s = Math.round(duration ?? 0);
    return `🎤 Message vocal${s ? ` (${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')})` : ''}`;
  }
  if (kind === 'video') return '🎥 Vidéo';
  if (kind === 'image') return '📷 Photo';
  return '';
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
  /** En sourdine : pas de notification push. */
  muted: boolean;
  /** Conversation à deux : présence de l'autre (null si masquée). */
  presence: Presence | null;
  /** Épinglée en haut de la liste. */
  pinned: boolean;
  /** Photo du groupe. */
  photo: MediaRef | null;
}

export interface ConversationDetail {
  id: ID;
  isGroup: boolean;
  title: string | null;
  user: UserLite | null;
  /** Tous les membres, moi compris. */
  members: UserLite[];
  createdBy: ID | null;
  /** Dernière lecture de chaque autre membre (accusés « Vu »). */
  reads: ReadMark[];
  muted: boolean;
  presence: Presence | null;
  photo: MediaRef | null;
}

export interface ReadMark {
  userId: ID;
  at: string;
}

export interface TypingEvent {
  conversationId: ID;
  userId: ID;
  typing: boolean;
  /** Ce qu'il fait : écrire, ou enregistrer un vocal. */
  activity?: 'text' | 'voice';
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
  | 'moment'
  | 'reaction'
  | 'mention'
  | 'poll_ended'
  | 'daily_meme'
  | 'alert'
  | 'birthday'
  | 'retro';

/** Catégories réglables dans « Notifications » (profil). */
export const NOTIF_CATEGORIES = [
  { key: 'social', label: 'J’aime et réactions', types: ['like', 'reaction', 'repost', 'shot_like'] },
  { key: 'comments', label: 'Commentaires et mentions', types: ['comment', 'mention'] },
  { key: 'friends', label: 'Amis, parrainages et anniversaires', types: ['friend_request', 'friend_accept', 'invite_joined', 'birthday'] },
  { key: 'messages', label: 'Messages', types: [] },
  { key: 'game', label: 'Make It Friends et mème du jour', types: ['game_invite', 'pool_added', 'pool_drawn', 'daily_meme'] },
  { key: 'pellicule', label: 'Pellicule et déballage', types: ['unpack', 'streak', 'moment'] },
  { key: 'polls', label: 'Fin de mes sondages', types: ['poll_ended'] },
  { key: 'retro', label: 'Rétro de l’année', types: ['retro'] },
  { key: 'system', label: 'Alertes du serveur (admins)', types: ['alert'] },
] as const satisfies readonly { key: string; label: string; types: readonly NotificationType[] }[];

export type NotifCategory = (typeof NOTIF_CATEGORIES)[number]['key'];

export interface NotificationPrefs {
  /** Catégories coupées en push. */
  push?: Partial<Record<NotifCategory, boolean>>;
  /** Catégories coupées dans la cloche. */
  bell?: Partial<Record<NotifCategory, boolean>>;
  /** Heures calmes (heures locales de Paris) : pas de push, la cloche reste remplie. */
  quiet?: { start: number; end: number } | null;
}

export function notifCategory(type: NotificationType | 'message'): NotifCategory {
  if (type === 'message') return 'messages';
  return NOTIF_CATEGORIES.find((c) => (c.types as readonly string[]).includes(type))?.key ?? 'social';
}

export interface AppNotification {
  id: ID;
  type: NotificationType;
  actor: UserLite | null;
  data: Record<string, unknown>;
  createdAt: string;
  read: boolean;
}

/** Tableau de bord de l'admin. */
export interface AdminStats {
  users: number;
  activeWeek: number;
  posts: number;
  messages: number;
  shots: number;
  mediaBytes: number;
  databaseBytes: number;
  disk: { totalBytes: number; freeBytes: number } | null;
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

// ——— Signalements, blocages, compte ———

export type ReportTarget = 'post' | 'comment' | 'story' | 'message' | 'user';
export const REPORT_REASONS = ['Contenu choquant', 'Harcèlement ou moquerie', 'Spam', 'Infos personnelles', 'Autre'] as const;
/** Nombre de signalements qui masque un contenu en attendant l'admin. */
export const REPORT_HIDE_THRESHOLD = 3;

export interface ModerationCase {
  targetType: ReportTarget;
  targetId: ID;
  reports: number;
  reasons: string[];
  reporters: UserLite[];
  /** Auteur du contenu (ou compte signalé). */
  author: UserLite | null;
  /** Aperçu : texte et média éventuel. */
  text: string;
  media: MediaRef | null;
  /** Lien pour ouvrir le contenu dans l'app. */
  url: string | null;
  hidden: boolean;
  authorSuspended: boolean;
  createdAt: string;
}

export interface BlockedUser extends UserLite {
  blockedAt: string;
}

export interface SessionInfo {
  id: string;
  current: boolean;
  device: string;
  createdAt: string;
  lastSeenAt: string | null;
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

// ——— Mème du jour et saisons ———

/** Horaires (Paris) du mème du jour : tirage le matin, votes le soir, résultats le lendemain. */
export const DAILY = { drawHour: 8, voteHour: 18, pointsPerVote: 50, winnerBonus: 100 } as const;
export type DailyPhase = 'caption' | 'vote' | 'closed';

export interface DailyCaption {
  id: ID;
  text: string;
  mine: boolean;
  /** Résultats seulement (phase « closed »). */
  votes: number | null;
  user: UserLite | null;
  winner: boolean;
}

export interface DailyMeme {
  day: string;
  media: MediaRef;
  phase: DailyPhase;
  /** Ouverture des votes. */
  voteAt: string;
  /** Fin des votes. */
  closeAt: string;
  participants: number;
  myCaption: string | null;
  myVote: ID | null;
  /** Vide pendant l'écriture ; anonymes pendant le vote ; signées avec les votes ensuite. */
  captions: DailyCaption[];
}

export interface DailyState {
  today: DailyMeme | null;
  yesterday: DailyMeme | null;
}

export interface SeasonEntry {
  user: UserLite;
  points: number;
  memes: number;
  wins: number;
  /** Bonnes réponses à « Qui a pris ça ? » ce mois-ci. */
  hits: number;
}

export interface SeasonState {
  month: string;
  label: string;
  ranking: SeasonEntry[];
  /** Champions des saisons précédentes. */
  champions: { month: string; label: string; user: UserLite; points: number }[];
}

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

// ——— Qui de nous… ? ———

export const WHOIS = {
  minPlayers: 3,
  maxPlayers: 8,
  roundOptions: [5, 8, 12] as const,
  questionSeconds: 25,
  questionMax: 120,
  /** Points pour qui a voté comme la majorité. */
  pointsMajority: 10,
} as const;

export type WhoisStage = 'lobby' | 'question' | 'reveal' | 'final';

export interface WhoisPlayer {
  user: UserLite;
  score: number;
  connected: boolean;
  voted: boolean;
}

export interface WhoisRoom {
  code: string;
  hostId: ID;
  players: WhoisPlayer[];
  rounds: number;
  stage: WhoisStage;
  round: number;
  deadline: string | null;
  /** Question en cours (et son auteur si elle vient de la bande). */
  question: { text: string; by: UserLite | null } | null;
  myVote: ID | null;
  /** Révélation : nombre de votes par joueur (anonymes), du plus au moins désigné. */
  results: { user: UserLite; votes: number }[];
  /** Fin de partie : questions « remportées » par chacun. */
  titles: { user: UserLite; questions: string[] }[];
  /** Questions de la bande disponibles pour ce salon. */
  customCount: number;
  error: string | null;
}

export interface WhoisQuestion {
  id: ID;
  text: string;
  author: UserLite;
  mine: boolean;
  createdAt: string;
}

// ——— Rétro de l'année ———

export interface RetroState {
  year: number;
  /** Assez d'activité pour une rétro (sinon on invite à revenir plus tard). */
  enough: boolean;
  posts: { total: number; photos: number; videos: number; polls: number; likes: number; reactions: number; comments: number };
  topPost: Post | null;
  pellicule: { shots: number; weeks: number; onTime: number; bestStreak: number; topShot: { media: MediaRef; likes: number } | null };
  memes: { count: number; points: number; wins: number; best: { caption: string; media: MediaRef; score: number } | null };
  guesses: { hits: number; played: number };
  messages: { sent: number; topFriend: { user: UserLite; count: number } | null; emoji: string | null };
  friends: { total: number; added: number };
  busiestMonth: { month: string; label: string; count: number } | null;
  /** Toute la bande, pour situer. */
  circle: { members: number; posts: number; shots: number };
}

/** Rétro proposée sur le fil du 1er décembre au 31 janvier (heure de Paris). */
export function retroYear(now = new Date()): number | null {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' }).format(now).split('-').map(Number);
  if (m === 12) return y;
  if (m === 1) return y - 1;
  return null;
}

export type Ack<T = undefined> = (res: { ok: true; data?: T } | { ok: false; error: string }) => void;

export interface ServerToClientEvents {
  'game:state': (room: GameRoom | null) => void;
  'whois:state': (room: WhoisRoom | null) => void;
  'notif:new': (n: AppNotification) => void;
  'dm:new': (m: Message) => void;
  presence: (e: Presence & { userId: ID }) => void;
  /** Un ami vient de publier : pastille « Nouveaux posts » sur le fil. */
  'feed:new': (e: { postId: ID; authorId: ID }) => void;
  /** Message modifié (supprimé pour tout le monde…). */
  'dm:update': (m: Message) => void;
  'dm:typing': (e: TypingEvent) => void;
  'dm:read': (e: ReadMark & { conversationId: ID }) => void;
  'dm:reaction': (e: { conversationId: ID; messageId: ID; reactions: MessageReaction[] }) => void;
  badges: (b: Badges) => void;
  'media:ready': (mediaId: ID) => void;
}

export interface ClientToServerEvents {
  'dm:typing': (conversationId: ID, typing: boolean, activity?: 'text' | 'voice') => void;
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
  'whois:create': (ack: Ack<WhoisRoom>) => void;
  'whois:join': (code: string, ack: Ack<WhoisRoom>) => void;
  'whois:leave': (ack: Ack) => void;
  'whois:sync': (ack: Ack<WhoisRoom | null>) => void;
  'whois:settings': (s: { rounds?: number }, ack: Ack) => void;
  'whois:start': (ack: Ack) => void;
  'whois:vote': (userId: ID, ack: Ack) => void;
  'whois:next': (ack: Ack) => void;
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
