import type { ClientToServerEvents, ServerToClientEvents } from '@mandrix/shared';
import type { Server } from 'socket.io';

export type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { userId: string }>;

let io: IO | null = null;

export const setIO = (s: IO) => {
  io = s;
};
export const getIO = () => io;

export function emitToUser<E extends keyof ServerToClientEvents>(
  userId: string,
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
) {
  io?.to(`u:${userId}`).emit(event, ...args);
}
