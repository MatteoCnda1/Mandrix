import type { PoolScope } from '@mandrix/shared';
import { create } from 'zustand';

export type SheetName = 'friends' | 'editProfile' | 'invite' | 'newMessage' | 'install';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface UIState {
  composer: null | { mode: 'post' | 'story'; kind?: 0 | 1 | 2; pool?: boolean };
  commentsFor: string | null;
  poolFor: null | { postId?: string; shotId?: string };
  story: null | { group: number; index: number };
  sheet: SheetName | null;
  toast: { msg: string; id: number; tone: 'ok' | 'error' } | null;
  installEvent: BeforeInstallPromptEvent | null;
  /** Une nouvelle version de l'app est prête (service worker en attente). */
  updateReady: boolean;
  applyUpdate: (() => void) | null;
  openComposer: (mode?: 'post' | 'story', kind?: 0 | 1 | 2, opts?: { pool?: boolean }) => void;
  closeAll: () => void;
}

export const useUI = create<UIState>((set) => ({
  composer: null,
  commentsFor: null,
  poolFor: null,
  story: null,
  sheet: null,
  toast: null,
  installEvent: null,
  updateReady: false,
  applyUpdate: null,
  openComposer: (mode = 'post', kind, opts) => set({ composer: { mode, kind, pool: opts?.pool }, sheet: null }),
  closeAll: () => set({ composer: null, commentsFor: null, poolFor: null, story: null, sheet: null }),
}));

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(msg: string, tone: 'ok' | 'error' = 'ok') {
  useUI.setState({ toast: { msg, id: Date.now(), tone } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => useUI.setState({ toast: null }), 2600);
}

export const openSheet = (sheet: SheetName) => useUI.setState({ sheet });
export const closeSheet = () => useUI.setState({ sheet: null });
export const openPool = (target: { postId?: string; shotId?: string }) => useUI.setState({ poolFor: target });
export type { PoolScope };
