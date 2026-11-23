import type { ClientToServerEvents, GameRoom, Message, ServerToClientEvents } from '@mandrix/shared';
import { io, type Socket } from 'socket.io-client';
import { create } from 'zustand';
import { qc } from './data';
import { toast } from './store';

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

export const useGame = create<{ room: GameRoom | null; connected: boolean; synced: boolean }>(() => ({
  room: null,
  connected: false,
  synced: false,
}));

export function getSocket() {
  return socket;
}

export function connectSocket() {
  if (socket) return socket;
  socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    useGame.setState({ connected: true });
    socket!.emit('game:sync', (res) => {
      if (res.ok) useGame.setState({ room: res.data ?? null, synced: true });
    });
    qc.invalidateQueries({ queryKey: ['badges'] });
  });
  socket.on('disconnect', () => useGame.setState({ connected: false }));
  socket.on('game:state', (room) => useGame.setState({ room }));
  socket.on('badges', (b) => qc.setQueryData(['badges'], b));
  socket.on('notif:new', (n) => {
    qc.invalidateQueries({ queryKey: ['notifications'] });
    const who = n.actor?.displayName;
    if (n.type === 'friend_request' && who) toast(`${who} veut devenir ton ami·e`);
    if (n.type === 'friend_accept' && who) {
      toast(`${who} a accepté ta demande`);
      for (const k of [['friends'], ['feed'], ['stories'], ['profile']]) qc.invalidateQueries({ queryKey: k });
    }
    if (n.type === 'unpack') qc.invalidateQueries({ queryKey: ['unpack'] });
    if (n.type === 'moment') {
      qc.invalidateQueries({ queryKey: ['pellicule'] });
      toast('C’est le moment Mandrix : 10 minutes pour ta photo 📸');
    }
  });
  socket.on('media:ready', () => {
    for (const k of [['feed'], ['reels'], ['stories'], ['user-posts'], ['post'], ['memes'], ['messages']]) qc.invalidateQueries({ queryKey: k });
  });
  socket.on('dm:new', (m: Message) => {
    qc.setQueryData<Message[]>(['messages', m.conversationId], (old) => (old && !old.some((x) => x.id === m.id) ? [...old, m] : old));
    qc.invalidateQueries({ queryKey: ['conversations'] });
    // Évènement de groupe (ajout, départ, nouveau nom) : on recharge la fiche du groupe.
    if (m.meta?.type === 'system') qc.invalidateQueries({ queryKey: ['conversation', m.conversationId] });
  });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
  useGame.setState({ room: null, connected: false, synced: false });
}

type Res<T> = { ok: true; data?: T } | { ok: false; error: string };

/** Émet un évènement de jeu et renvoie une promesse (erreurs affichées en toast). */
export function gameEmit<T = undefined>(event: keyof ClientToServerEvents, ...args: unknown[]): Promise<T | undefined> {
  return new Promise((resolve) => {
    const s = socket;
    if (!s || !s.connected) {
      toast('Connexion au serveur en cours…', 'error');
      return resolve(undefined);
    }
    const ack = (res: Res<T>) => {
      if (res.ok) resolve(res.data);
      else {
        toast(res.error, 'error');
        resolve(undefined);
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s.emit as any)(event, ...args, ack);
  });
}
