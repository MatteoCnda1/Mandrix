import { WHOIS, type UserLite, type WhoisRoom, type WhoisStage } from '@mandrix/shared';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { fail } from '../lib/http.js';
import { friendIds, usersByIds, uuidArray } from '../lib/users.js';
import { WHOIS_DECK } from '../lib/whoisDeck.js';
import { emitToUser } from './io.js';

// « Qui de nous… ? » : une question, chacun désigne un joueur (soi compris), révélation anonyme.
// Salons en mémoire, comme Make It Friends (codes QDN-###).

interface Player {
  user: UserLite;
  score: number;
  connected: boolean;
  leaveTimer?: NodeJS.Timeout;
}

interface Question {
  text: string;
  authorId: string | null;
}

interface Room {
  code: string;
  hostId: string;
  players: Map<string, Player>;
  rounds: number;
  stage: WhoisStage;
  round: number;
  deadline: number | null;
  timer?: NodeJS.Timeout;
  deck: Question[];
  customCount: number;
  question: Question | null;
  votes: Map<string, string>;
  results: { userId: string; votes: number }[];
  titles: Map<string, string[]>;
  error: string | null;
}

const rooms = new Map<string, Room>();
const userRoom = new Map<string, string>();
const userSockets = new Map<string, Set<string>>();
/** Durée de la question (modifiable en test). */
export const whoisTiming = { questionMs: WHOIS.questionSeconds * 1000 };

const ghost = (id: string): UserLite => ({ id, username: '?', displayName: 'Ancien joueur', avatarUrl: null, initials: '?', tone: 0 });

function viewFor(room: Room, userId: string): WhoisRoom {
  const user = (id: string) => room.players.get(id)?.user ?? ghost(id);
  const reveal = room.stage === 'reveal' || room.stage === 'final';
  return {
    code: room.code,
    hostId: room.hostId,
    players: [...room.players.values()].map((p) => ({ user: p.user, score: p.score, connected: p.connected, voted: room.votes.has(p.user.id) })),
    rounds: room.rounds,
    stage: room.stage,
    round: room.round,
    deadline: room.deadline ? new Date(room.deadline).toISOString() : null,
    question: room.question ? { text: room.question.text, by: room.question.authorId ? user(room.question.authorId) : null } : null,
    myVote: room.votes.get(userId) ?? null,
    results: reveal ? room.results.map((r) => ({ user: user(r.userId), votes: r.votes })) : [],
    titles:
      room.stage === 'final'
        ? [...room.titles.entries()].filter(([, q]) => q.length).map(([id, questions]) => ({ user: user(id), questions }))
        : [],
    customCount: room.customCount,
    error: room.error,
  };
}

function broadcast(room: Room) {
  for (const id of room.players.keys()) emitToUser(id, 'whois:state', viewFor(room, id));
}

function clearTimer(room: Room) {
  clearTimeout(room.timer);
  room.timer = undefined;
  room.deadline = null;
}

function newCode() {
  for (;;) {
    const code = `QDN-${Math.floor(100 + Math.random() * 900)}`;
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
  if (!room) fail(400, 'Tu n’es dans aucun salon « Qui de nous… ? »');
  return room!;
}

function requireHost(room: Room, userId: string) {
  if (room.hostId !== userId) fail(403, 'Seul l’hôte peut faire ça');
}

const shuffled = <T>(list: T[]) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Questions de la bande : celles des joueurs et de leurs amis. */
async function customQuestions(playerIds: string[]): Promise<Question[]> {
  const circle = new Set(playerIds);
  for (const id of playerIds) for (const f of await friendIds(id)) circle.add(f);
  const rows = await db.execute<{ text: string; authorId: string }>(sql`
    select text, author_id as "authorId" from whois_questions where author_id = any(${uuidArray([...circle])}) order by created_at desc limit 300`);
  return [...rows].map((r) => ({ text: r.text, authorId: r.authorId }));
}

/** Paquet de la partie : moitié de questions de la bande au plus, le reste dans les questions de base. */
async function buildDeck(room: Room) {
  const custom = shuffled(await customQuestions([...room.players.keys()]));
  room.customCount = custom.length;
  const fromCustom = custom.slice(0, Math.max(Math.ceil(room.rounds / 2), room.rounds - WHOIS_DECK.length));
  const base = shuffled(WHOIS_DECK.map((text) => ({ text, authorId: null }))).slice(0, room.rounds - fromCustom.length);
  room.deck = shuffled([...fromCustom, ...base]);
}

export async function createRoom(userId: string) {
  leaveRoom(userId);
  const user = await loadUser(userId);
  const room: Room = {
    code: newCode(),
    hostId: userId,
    players: new Map([[userId, { user, score: 0, connected: true }]]),
    rounds: WHOIS.roundOptions[1],
    stage: 'lobby',
    round: 0,
    deadline: null,
    deck: [],
    customCount: (await customQuestions([userId])).length,
    question: null,
    votes: new Map(),
    results: [],
    titles: new Map(),
    error: null,
  };
  rooms.set(room.code, room);
  userRoom.set(userId, room.code);
  broadcast(room);
  return viewFor(room, userId);
}

export async function joinRoom(userId: string, rawCode: string) {
  const code = String(rawCode ?? '').trim().toUpperCase().replace(/^(QDN)?-?/, 'QDN-');
  const room = rooms.get(code);
  if (!room) fail(404, 'Salon introuvable');
  if (room!.players.has(userId)) {
    userRoom.set(userId, code);
    return viewFor(room!, userId);
  }
  if (room!.stage !== 'lobby') fail(409, 'La partie a déjà commencé');
  if (room!.players.size >= WHOIS.maxPlayers) fail(409, 'Le salon est complet');
  leaveRoom(userId);
  const user = await loadUser(userId);
  room!.players.set(userId, { user, score: 0, connected: true });
  userRoom.set(userId, code);
  room!.customCount = (await customQuestions([...room!.players.keys()])).length;
  broadcast(room!);
  return viewFor(room!, userId);
}

export function leaveRoom(userId: string) {
  const code = userRoom.get(userId);
  if (!code) return;
  userRoom.delete(userId);
  const room = rooms.get(code);
  if (!room) return;
  clearTimeout(room.players.get(userId)?.leaveTimer);
  room.players.delete(userId);
  room.votes.delete(userId);
  emitToUser(userId, 'whois:state', null);
  if (room.players.size === 0) {
    clearTimer(room);
    rooms.delete(code);
    return;
  }
  if (room.hostId === userId) room.hostId = [...room.players.keys()][0];
  if (room.stage !== 'lobby' && room.stage !== 'final' && room.players.size < WHOIS.minPlayers) {
    clearTimer(room);
    room.stage = 'final';
  } else if (room.stage === 'question') {
    // Un vote pour la personne partie ne compte plus.
    for (const [voter, target] of room.votes) if (target === userId) room.votes.delete(voter);
    if (maybeReveal(room)) return;
  }
  broadcast(room);
}

export function syncRoom(userId: string) {
  const code = userRoom.get(userId);
  const room = code ? rooms.get(code) : undefined;
  return room ? viewFor(room, userId) : null;
}

export function updateSettings(userId: string, s: { rounds?: number }) {
  const room = requireRoom(userId);
  requireHost(room, userId);
  if (room.stage !== 'lobby') fail(409, 'Partie en cours');
  if (s.rounds !== undefined && (WHOIS.roundOptions as readonly number[]).includes(s.rounds)) room.rounds = s.rounds;
  broadcast(room);
}

export async function startGame(userId: string) {
  const room = requireRoom(userId);
  requireHost(room, userId);
  if (room.stage !== 'lobby' && room.stage !== 'final') fail(409, 'Partie déjà lancée');
  if (room.players.size < WHOIS.minPlayers) fail(400, `Il faut au moins ${WHOIS.minPlayers} joueurs`);
  for (const p of room.players.values()) p.score = 0;
  room.round = 0;
  room.titles = new Map();
  room.error = null;
  await buildDeck(room);
  nextQuestion(room);
}

function nextQuestion(room: Room) {
  const q = room.deck[room.round];
  if (!q) {
    room.stage = 'final';
    clearTimer(room);
    broadcast(room);
    return;
  }
  room.round++;
  room.stage = 'question';
  room.question = q;
  room.votes = new Map();
  room.results = [];
  clearTimeout(room.timer);
  room.deadline = Date.now() + whoisTiming.questionMs;
  room.timer = setTimeout(() => reveal(room), whoisTiming.questionMs);
  broadcast(room);
}

export function vote(userId: string, targetId: string) {
  const room = requireRoom(userId);
  if (room.stage !== 'question') fail(409, 'Le vote est terminé');
  if (!room.players.has(String(targetId))) fail(400, 'Choisis un joueur du salon');
  room.votes.set(userId, String(targetId));
  if (!maybeReveal(room)) broadcast(room);
}

function maybeReveal(room: Room) {
  const active = [...room.players.values()].filter((p) => p.connected);
  if (active.length > 0 && active.every((p) => room.votes.has(p.user.id))) {
    reveal(room);
    return true;
  }
  return false;
}

/** Révélation : décompte anonyme ; qui a voté comme la majorité marque des points, le plus désigné gagne la question. */
function reveal(room: Room) {
  if (room.stage !== 'question') return;
  clearTimer(room);
  const counts = new Map<string, number>();
  for (const target of room.votes.values()) if (room.players.has(target)) counts.set(target, (counts.get(target) ?? 0) + 1);
  room.results = [...room.players.keys()]
    .map((id) => ({ userId: id, votes: counts.get(id) ?? 0 }))
    .sort((a, b) => b.votes - a.votes);
  const top = room.results[0]?.votes ?? 0;
  if (top > 0) {
    const leaders = new Set(room.results.filter((r) => r.votes === top).map((r) => r.userId));
    for (const [voter, target] of room.votes) {
      const p = room.players.get(voter);
      if (p && leaders.has(target)) p.score += WHOIS.pointsMajority;
    }
    for (const id of leaders) room.titles.set(id, [...(room.titles.get(id) ?? []), room.question!.text]);
  }
  room.stage = 'reveal';
  broadcast(room);
}

export function next(userId: string) {
  const room = requireRoom(userId);
  requireHost(room, userId);
  if (room.stage === 'reveal') {
    if (room.round < room.rounds && room.players.size >= WHOIS.minPlayers) nextQuestion(room);
    else {
      room.stage = 'final';
      broadcast(room);
    }
  } else if (room.stage === 'final') {
    room.stage = 'lobby';
    room.round = 0;
    room.question = null;
    room.votes = new Map();
    room.results = [];
    room.titles = new Map();
    for (const p of room.players.values()) p.score = 0;
    broadcast(room);
  } else fail(409, 'Action impossible maintenant');
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
  if (room.stage !== 'question' || !maybeReveal(room)) broadcast(room);
  // Une minute pour revenir (changement d'appli, réseau mobile…).
  p.leaveTimer = setTimeout(() => {
    if (!p.connected) leaveRoom(userId);
  }, 60_000);
}
