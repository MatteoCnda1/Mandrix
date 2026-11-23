import type { PoolScope, Post } from '@mandrix/shared';
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
  /** Post à envoyer en message (#73). */
  shareFor: Post | null;
  story: null | { group: number; index: number };
  sheet: SheetName | null;
  /** Jeu du salon auquel inviter (feuille « Inviter des amis »). */
  inviteGame: 'mif' | 'whois';
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
  shareFor: null,
  story: null,
  sheet: null,
  inviteGame: 'mif',
  toast: null,
  installEvent: null,
  updateReady: false,
  applyUpdate: null,
  openComposer: (mode = 'post', kind, opts) => set({ composer: { mode, kind, pool: opts?.pool }, sheet: null }),
  closeAll: () => set({ composer: null, commentsFor: null, poolFor: null, shareFor: null, story: null, sheet: null }),
}));

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(msg: string, tone: 'ok' | 'error' = 'ok') {
  useUI.setState({ toast: { msg, id: Date.now(), tone } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => useUI.setState({ toast: null }), 2600);
}

export const openSheet = (sheet: SheetName) => useUI.setState({ sheet, ...(sheet === 'invite' ? { inviteGame: 'mif' as const } : {}) });
/** Inviter des amis dans le salon en cours (Make It Friends ou Qui de nous… ?). */
export const openInvite = (game: 'mif' | 'whois') => useUI.setState({ sheet: 'invite', inviteGame: game });
export const closeSheet = () => useUI.setState({ sheet: null });
export const openShare = (post: Post) => useUI.setState({ shareFor: post });
export const openPool = (target: { postId?: string; shotId?: string }) => useUI.setState({ poolFor: target });
export type { PoolScope };
