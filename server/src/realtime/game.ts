import { randomUUID } from 'node:crypto';
import { GAME, type GameMeme, type GameRoom, type GameSource, type GameStage, type PoolImage, type UserLite } from '@mandrix/shared';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';
import { fail } from '../lib/http.js';
import { usersByIds } from '../lib/users.js';
import { drawPool, reportPoolItem } from '../routes/pool.js';
import { emitToUser } from './io.js';

interface Player {
  user: UserLite;
  score: number;
  roundScore: number;
  connected: boolean;
  leaveTimer?: NodeJS.Timeout;
}

interface Meme {
  id: string;
  authorId: string;
  image: PoolImage;
  caption: string;
  ratings: Map<string, number>;
  score: number;
}

interface Room {
  code: string;
  hostId: string;
  players: Map<string, Player>;
  rounds: number;
  source: GameSource;
  seconds: number;
  stage: GameStage;
  round: number;
  deadline: number | null;
  timer?: NodeJS.Timeout;
  images: Map<string, PoolImage>;
  shuffles: Map<string, number>;
  captions: Map<string, string>;
  memes: Meme[];
  winner: Meme | null;
  used: Set<string>;
  published: Set<string>;
  error: string | null;
}

const rooms = new Map<string, Room>();
const userRoom = new Map<string, string>();
const userSockets = new Map<string, Set<string>>();

// ——— Vue par joueur ———

function memeView(room: Room, m: Meme, viewer: string): GameMeme {
  return {
    id: m.id,
    image: m.image,
    caption: m.caption,
    author: room.players.get(m.authorId)?.user ?? { id: m.authorId, username: '?', displayName: 'Ancien joueur', avatarUrl: null, initials: '?', tone: 0 },
    mine: m.authorId === viewer,
    myRating: m.ratings.get(viewer) ?? null,
    score: room.stage === 'vote' ? 0 : m.score,
  };
}

function hasVotedAll(room: Room, userId: string) {
  return room.memes.every((m) => m.authorId === userId || m.ratings.has(userId));
}

function myMeme(room: Room, userId: string) {
  return room.memes.find((m) => m.authorId === userId) ?? null;
}

function viewFor(room: Room, userId: string): GameRoom {
  const mine = myMeme(room, userId);
  const showResults = room.stage === 'results' || room.stage === 'final';
  return {
    code: room.code,
    hostId: room.hostId,
    players: [...room.players.values()].map((p) => ({
      user: p.user,
      score: p.score,
      roundScore: p.roundScore,
      connected: p.connected,
      submitted: room.captions.has(p.user.id),
      voted: room.stage === 'vote' && hasVotedAll(room, p.user.id),
    })),
    rounds: room.rounds,
    source: room.source,
    seconds: room.seconds,
    stage: room.stage,
    round: room.round,
    deadline: room.deadline ? new Date(room.deadline).toISOString() : null,
    me: {
      image: room.images.get(userId) ?? null,
      caption: room.captions.get(userId) ?? null,
      shufflesLeft: room.shuffles.get(userId) ?? 0,
      memeId: mine?.id ?? null,
      published: !!mine && room.published.has(mine.id),
    },
    memes:
      room.stage === 'vote'
        ? room.memes.filter((m) => m.authorId !== userId).map((m) => memeView(room, m, userId))
        : showResults
          ? [...room.memes].sort((a, b) => b.score - a.score).map((m) => memeView(room, m, userId))
          : [],
    winner: showResults && room.winner ? memeView(room, room.winner, userId) : null,
    error: room.error,
  };
}

function broadcast(room: Room) {
  for (const id of room.players.keys()) emitToUser(id, 'game:state', viewFor(room, id));
}

function setTimer(room: Room, ms: number, fn: () => void) {
  clearTimeout(room.timer);
  room.deadline = Date.now() + ms;
  room.timer = setTimeout(() => {
    room.timer = undefined;
    Promise.resolve(fn()).catch((e) => console.error('[game] timer', e));
  }, ms);
}

function clearTimer(room: Room) {
  clearTimeout(room.timer);
  room.timer = undefined;
  room.deadline = null;
}

// ——— Gestion des salons ———

function newCode() {
  for (;;) {
    const code = `MDRX-${Math.floor(100 + Math.random() * 900)}`;
    if (!rooms.has(code)) return code;
  }
}

async function loadUser(userId: string) {
  const u = (await usersByIds([userId])).get(userId);
  if (!u) fail(401, 'Session expirée');
  return u!;
}

function requireRoom(userId: string) {
  const code = userRoom.get(userId);
  const room = code ? rooms.get(code) : undefined;
  if (!room) fail(400, 'Tu n’es dans aucun salon');
  return room!;
}

function requireHost(room: Room, userId: string) {
  if (room.hostId !== userId) fail(403, 'Seul l’hôte peut faire ça');
}

export async function createRoom(userId: string) {
  leaveRoom(userId);
  const user = await loadUser(userId);
  const room: Room = {
    code: newCode(),
    hostId: userId,
    players: new Map([[userId, { user, score: 0, roundScore: 0, connected: true }]]),
    rounds: 3,
    source: 'public',
    seconds: env.roundSeconds,
    stage: 'lobby',
    round: 0,
    deadline: null,
    images: new Map(),
    shuffles: new Map(),
    captions: new Map(),
    memes: [],
    winner: null,
    used: new Set(),
    published: new Set(),
    error: null,
  };
  rooms.set(room.code, room);
  userRoom.set(userId, room.code);
  return viewFor(room, userId);
}

export async function joinRoom(userId: string, rawCode: string) {
  const code = String(rawCode ?? '').trim().toUpperCase().replace(/^(MDRX)?-?/, 'MDRX-');
  const room = rooms.get(code);
  if (!room) fail(404, 'Salon introuvable');
  if (room!.players.has(userId)) {
    userRoom.set(userId, code);
    return viewFor(room!, userId);
  }
  if (room!.stage !== 'lobby') fail(409, 'La partie a déjà commencé');
  if (room!.players.size >= GAME.maxPlayers) fail(409, 'Le salon est complet');
  leaveRoom(userId);
  const user = await loadUser(userId);
  room!.players.set(userId, { user, score: 0, roundScore: 0, connected: true });
  userRoom.set(userId, code);
  broadcast(room!);
  return viewFor(room!, userId);
}

export function leaveRoom(userId: string) {
  const code = userRoom.get(userId);
  if (!code) return;
  userRoom.delete(userId);
  const room = rooms.get(code);
  if (!room) return;
  const p = room.players.get(userId);
  clearTimeout(p?.leaveTimer);
  room.players.delete(userId);
  emitToUser(userId, 'game:state', null);
  if (room.players.size === 0) {
    clearTimer(room);
    rooms.delete(code);
    return;
  }
  if (room.hostId === userId) room.hostId = [...room.players.keys()][0];
  if (room.stage !== 'lobby' && room.stage !== 'final' && room.players.size < GAME.minPlayers) {
    clearTimer(room);
    room.stage = 'final';
  } else if (room.stage === 'caption') {
    maybeEndCaption(room);
  } else if (room.stage === 'vote') {
    maybeEndVote(room);
  }
  broadcast(room);
}

export function syncRoom(userId: string) {
  const code = userRoom.get(userId);
  const room = code ? rooms.get(code) : undefined;
  return room ? viewFor(room, userId) : null;
}

export function updateSettings(userId: string, s: { rounds?: number; source?: GameSource }) {
  const room = requireRoom(userId);
  requireHost(room, userId);
  if (room.stage !== 'lobby') fail(409, 'Partie en cours');
  if (s.rounds !== undefined && (GAME.roundOptions as readonly number[]).includes(s.rounds)) room.rounds = s.rounds;
  if (s.source === 'public' || s.source === 'friends') room.source = s.source;
  broadcast(room);
}

export async function startGame(userId: string) {
  const room = requireRoom(userId);
  requireHost(room, userId);
  if (room.stage !== 'lobby' && room.stage !== 'final') fail(409, 'Partie déjà lancée');
  if (room.players.size < GAME.minPlayers) fail(400, 'Invite au moins un ami pour jouer');
  for (const p of room.players.values()) {
    p.score = 0;
    p.roundScore = 0;
  }
  room.round = 0;
  room.used.clear();
  room.published.clear();
  room.error = null;
  await nextRound(room);
}

async function nextRound(room: Room) {
  const ids = [...room.players.keys()];
  let images = await drawPool({ count: ids.length, source: room.source, playerIds: ids, hostId: room.hostId, exclude: [...room.used] });
  if (images.length < ids.length) {
    // Pool trop petit : on autorise les doublons.
    const extra = await drawPool({ count: ids.length, source: room.source, playerIds: ids, hostId: room.hostId, exclude: [] });
    images = images.concat(extra);
  }
  if (images.length === 0) {
    room.stage = 'lobby';
    room.error = 'Le pool est vide : envoie des photos dans le pool pour jouer.';
    broadcast(room);
    return;
  }
  room.round++;
  room.stage = 'caption';
  room.error = null;
  room.captions.clear();
  room.memes = [];
  room.winner = null;
  room.images.clear();
  ids.forEach((id, i) => {
    const img = images[i % images.length];
    room.images.set(id, img);
    room.used.add(img.itemId);
    room.shuffles.set(id, GAME.shufflesPerRound);
    room.players.get(id)!.roundScore = 0;
  });
  setTimer(room, room.seconds * 1000, () => endCaption(room));
  broadcast(room);
}

async function replaceImage(room: Room, userId: string) {
  const [img] = await drawPool({ count: 1, source: room.source, playerIds: [...room.players.keys()], hostId: room.hostId, exclude: [...room.used] });
  if (!img) fail(404, 'Plus d’autre image disponible dans le pool');
  room.images.set(userId, img);
  room.used.add(img.itemId);
}

export async function shuffle(userId: string) {
  const room = requireRoom(userId);
  if (room.stage !== 'caption' || room.captions.has(userId)) fail(409, 'Trop tard pour changer d’image');
  const left = room.shuffles.get(userId) ?? 0;
  if (left <= 0) fail(429, 'Plus de changement d’image pour cette manche');
  await replaceImage(room, userId);
  room.shuffles.set(userId, left - 1);
  emitToUser(userId, 'game:state', viewFor(room, userId));
}

export async function report(userId: string) {
  const room = requireRoom(userId);
  const img = room.images.get(userId);
  if (room.stage !== 'caption' || !img) fail(409, 'Aucune image à signaler');
  await reportPoolItem(img!.itemId, userId);
  if (!room.captions.has(userId)) await replaceImage(room, userId).catch(() => room.images.delete(userId));
  emitToUser(userId, 'game:state', viewFor(room, userId));
}

export function submitCaption(userId: string, raw: string) {
  const room = requireRoom(userId);
  if (room.stage !== 'caption') fail(409, 'La manche est terminée');
  const text = String(raw ?? '').trim().slice(0, GAME.captionMax);
  if (!text) fail(400, 'Écris une légende');
  if (!room.images.has(userId)) fail(409, 'Aucune image');
  room.captions.set(userId, text);
  if (!maybeEndCaption(room)) broadcast(room);
}

function maybeEndCaption(room: Room) {
  const active = [...room.players.values()].filter((p) => p.connected);
  if (active.length > 0 && active.every((p) => room.captions.has(p.user.id))) {
    endCaption(room);
    return true;
  }
  return false;
}

function endCaption(room: Room) {
  if (room.stage !== 'caption') return;
  room.memes = [...room.captions.entries()].map(([authorId, caption]) => ({
    id: randomUUID(),
    authorId,
    image: room.images.get(authorId)!,
    caption,
    ratings: new Map(),
    score: 0,
  }));
  if (room.memes.length === 0) {
    clearTimer(room);
    room.stage = 'results';
    broadcast(room);
    return;
  }
  room.stage = 'vote';
  const perVoter = Math.max(1, room.memes.length - 1);
  setTimer(room, perVoter * GAME.voteSecondsPerMeme * 1000 + 3000, () => endVote(room));
  if (!maybeEndVote(room)) broadcast(room);
}

export function rate(userId: string, memeId: string, rating: number) {
  const room = requireRoom(userId);
  if (room.stage !== 'vote') fail(409, 'Le vote est terminé');
  const meme = room.memes.find((m) => m.id === memeId);
  if (!meme) fail(404, 'Mème introuvable');
  if (meme!.authorId === userId) fail(400, 'Tu ne peux pas noter ton propre mème');
  const r = Math.trunc(Number(rating));
  if (!GAME.ratings.some((x) => x.value === r)) fail(400, 'Note invalide');
  meme!.ratings.set(userId, r);
  if (!maybeEndVote(room)) broadcast(room);
}

function maybeEndVote(room: Room) {
  const voters = [...room.players.values()].filter((p) => p.connected).map((p) => p.user.id);
  if (voters.every((id) => hasVotedAll(room, id))) {
    void endVote(room);
    return true;
  }
  return false;
}

async function endVote(room: Room) {
  if (room.stage !== 'vote') return;
  clearTimer(room);
  for (const m of room.memes) {
    m.score = [...m.ratings.values()].reduce((sum, r) => sum + (GAME.ratings.find((x) => x.value === r)?.points ?? 0), 0);
    const p = room.players.get(m.authorId);
    if (p) {
      p.roundScore = m.score;
      p.score += m.score;
    }
  }
  room.winner = [...room.memes].sort((a, b) => b.score - a.score)[0] ?? null;
  room.stage = 'results';
  broadcast(room);
  try {
    await db.insert(schema.memes).values(
      room.memes.map((m) => ({
        id: m.id,
        authorId: m.authorId,
        mediaId: m.image.media.id,
        caption: m.caption,
        score: m.score,
        isWinner: !!room.winner && room.winner.id === m.id && m.score > 0,
        gameCode: room.code,
        round: room.round,
      })),
    );
  } catch (e) {
    console.error('[game] enregistrement des mèmes', e);
  }
}

export async function next(userId: string) {
  const room = requireRoom(userId);
  requireHost(room, userId);
  if (room.stage === 'results') {
    if (room.round < room.rounds && room.players.size >= GAME.minPlayers) await nextRound(room);
    else {
      room.stage = 'final';
      broadcast(room);
    }
  } else if (room.stage === 'final') {
    room.stage = 'lobby';
    room.round = 0;
    room.memes = [];
    room.winner = null;
    room.captions.clear();
    room.images.clear();
    for (const p of room.players.values()) {
      p.score = 0;
      p.roundScore = 0;
    }
    broadcast(room);
  } else fail(409, 'Action impossible maintenant');
}

export async function publish(userId: string) {
  const room = requireRoom(userId);
  if (room.stage !== 'results' && room.stage !== 'final') fail(409, 'Attends la fin de la manche');
  const meme = myMeme(room, userId);
  if (!meme) fail(404, 'Tu n’as pas de mème dans cette manche');
  if (room.published.has(meme!.id)) fail(409, 'Mème déjà publié');
  const [post] = await db
    .insert(schema.posts)
    .values({ authorId: userId, kind: 'meme', text: meme!.caption, mediaId: meme!.image.media.id })
    .returning();
  await db.update(schema.memes).set({ postId: post.id }).where(eq(schema.memes.id, meme!.id));
  room.published.add(meme!.id);
  emitToUser(userId, 'game:state', viewFor(room, userId));
  return { postId: post.id };
}

// ——— Présence ———

export function onConnect(userId: string, socketId: string) {
  let set = userSockets.get(userId);
  if (!set) userSockets.set(userId, (set = new Set()));
  set.add(socketId);
  const code = userRoom.get(userId);
  const room = code ? rooms.get(code) : undefined;
  const p = room?.players.get(userId);
  if (room && p) {
    clearTimeout(p.leaveTimer);
    p.leaveTimer = undefined;
    if (!p.connected) {
      p.connected = true;
      broadcast(room);
    }
  }
}

export function onDisconnect(userId: string, socketId: string) {
  const set = userSockets.get(userId);
  set?.delete(socketId);
  if (set && set.size > 0) return;
  userSockets.delete(userId);
  const code = userRoom.get(userId);
  const room = code ? rooms.get(code) : undefined;
  const p = room?.players.get(userId);
  if (!room || !p) return;
  p.connected = false;
  if (room.stage === 'caption') maybeEndCaption(room);
  else if (room.stage === 'vote') maybeEndVote(room);
  broadcast(room);
  // Laisse une minute pour revenir (changement d'appli, réseau mobile…).
  p.leaveTimer = setTimeout(() => {
    if (!p.connected) leaveRoom(userId);
  }, 60_000);
}
