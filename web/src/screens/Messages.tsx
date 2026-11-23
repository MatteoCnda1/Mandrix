import { attachmentLabel, conversationName, MESSAGE_REACTIONS, type Conversation, type ConversationDetail, type MediaRef, type Message, type UserLite } from '@mandrix/shared';
import {
  ArrowBendUpLeft,
  Bell,
  BellSlash,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChatCircleDots,
  CheckCircle,
  Copy,
  Flag,
  Microphone,
  PaperPlaneRight,
  Paperclip,
  PencilSimple,
  SignOut,
  Trash,
  UserPlus,
  UsersThree,
  X,
} from '@phosphor-icons/react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { MediaLightbox, MessagePhotoVideo, VoicePlayer } from '../components/ChatMedia';
import { ReactionPicker, type MenuAction } from '../components/Reactions';
import { openReport } from '../components/Report';
import { Avatar, EmptyCard, MediaView, PrimaryBtn, PullIndicator, ScreenLoader, Sheet, Switch, confirmAction, cx, fmtDuration, useFilePicker } from '../components/ui';
import { api, errMsg, upload } from '../lib/api';
import { useSwipeX } from '../lib/gestures';
import { useLongPress, useObjectUrl, type Point } from '../lib/hooks';
import { useVoiceRecorder, voiceFileName, voiceSupported, VOICE_MAX_SECONDS } from '../lib/recorder';
import { qc, useConversation, useConversations, useFriends, useMe, useMessages } from '../lib/data';
import { shortTime } from '../lib/format';
import { useNow, usePullToRefresh } from '../lib/hooks';
import { useLockPageScroll } from '../lib/keyboard';
import { useGoBack } from '../lib/nav';
import { sendTyping, useTyping } from '../lib/socket';
import { openSheet, toast } from '../lib/store';
import { useViewport } from '../lib/theme';

/** Avatar d'une conversation : la personne, ou deux avatars superposés pour un groupe. */
export function ConvAvatar({ isGroup, user, members, size = 48 }: { isGroup: boolean; user: UserLite | null; members: UserLite[]; size?: number }) {
  if (!isGroup && user) return <Avatar user={user} size={size} />;
  const [a, b] = members;
  if (!a) {
    return (
      <span className="grid flex-none place-items-center rounded-full bg-tint text-ink" style={{ width: size, height: size }}>
        <UsersThree size={size * 0.45} weight="fill" />
      </span>
    );
  }
  const s = Math.round(size * 0.7);
  return (
    <span className="relative flex-none" style={{ width: size, height: size }}>
      <Avatar user={a} size={s} className="absolute top-0 left-0" />
      {b && <Avatar user={b} size={s} className="absolute right-0 bottom-0 shadow-[0_0_0_2px_var(--card)]" />}
    </span>
  );
}

export function Messages() {
  const nav = useNavigate();
  const { data: me } = useMe();
  const { data, isLoading } = useConversations();
  const now = useNow(60_000);
  const typing = useTyping();
  const { pull, refreshing } = usePullToRefresh(() => qc.invalidateQueries({ queryKey: ['conversations'] }));
  if (isLoading) return <ScreenLoader />;
  return (
    <div data-screen-label="Messages" className="flex animate-in flex-col gap-3">
      <PullIndicator pull={pull} refreshing={refreshing} />
      <button
        type="button"
        onClick={() => openSheet('newMessage')}
        className="tap flex h-[52px] items-center gap-2.5 self-start rounded-[26px] border-0 bg-card px-5 text-[0.9375rem] font-bold text-ink shadow-pill active:scale-[.97]"
      >
        <PencilSimple size={20} /> Nouveau message
      </button>
      {data?.length === 0 ? (
        <EmptyCard icon={<ChatCircleDots size={30} weight="fill" />} title="Aucune conversation" text="Écris à un ami, crée un groupe, réponds à une story ou invite quelqu’un dans un salon Make It Friends.">
          <PrimaryBtn onClick={() => openSheet('newMessage')}>Écrire à un ami</PrimaryBtn>
        </EmptyCard>
      ) : (
        <div className="card flex flex-col gap-0.5 p-2">
          {data?.map((c) => {
            const muteActions: MenuAction[] = [
              {
                label: c.muted ? 'Réactiver les notifications' : 'Mettre en sourdine',
                icon: c.muted ? <Bell size={18} /> : <BellSlash size={18} />,
                onClick: () => void setMuted(c.id, !c.muted),
              },
            ];
            const preview = !c.last
              ? c.isGroup
                ? 'Nouveau groupe'
                : 'Nouvelle conversation'
              : c.last.system
                ? c.last.text
                : `${c.last.mine ? 'Toi : ' : c.last.sender ? `${c.last.sender} : ` : ''}${c.last.text}`;
            return (
              <ConvRow key={c.id} onOpen={() => nav(`/messages/${c.id}`)} actions={muteActions}>
                <ConvAvatar isGroup={c.isGroup} user={c.user} members={c.members} />
                <span className="min-w-0 flex-1">
                  <span className={cx('block truncate text-[0.9375rem]', c.unread ? 'font-extrabold' : 'font-bold')}>{conversationName(c, me?.id)}</span>
                  {typing[c.id]?.length ? (
                    <span className="block truncate text-sm font-semibold text-acc">
                      {c.isGroup ? `${c.members.find((u) => u.id === typing[c.id][0])?.displayName.split(' ')[0] ?? 'Quelqu’un'} écrit…` : 'écrit…'}
                    </span>
                  ) : (
                    <span className={cx('block truncate text-sm', c.unread ? 'font-semibold text-ink' : 'text-mute', c.last?.system && 'italic')}>{preview}</span>
                  )}
                </span>
                <span className="flex flex-none flex-col items-end gap-1.5">
                  <span className="flex items-center gap-1 text-xs text-mute">
                    {c.muted && <BellSlash size={13} aria-label="En sourdine" />}
                    {c.last ? shortTime(c.last.at, now) : ''}
                  </span>
                  <span className={cx('h-2.5 w-2.5 rounded-full', c.muted ? 'bg-mute' : 'bg-brand')} style={{ opacity: c.unread ? 1 : 0 }} />
                </span>
              </ConvRow>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Sourdine d'une conversation (liste, fiche du groupe). */
async function setMuted(id: string, muted: boolean) {
  try {
    await api(`/api/conversations/${id}/mute`, { method: 'PATCH', body: { muted } });
    qc.setQueryData<Conversation[]>(['conversations'], (old) => old?.map((c) => (c.id === id ? { ...c, muted } : c)));
    qc.setQueryData<ConversationDetail>(['conversation', id], (old) => (old ? { ...old, muted } : old));
    toast(muted ? 'Conversation en sourdine' : 'Notifications réactivées');
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

/** Ligne de la liste : toucher ouvre, appui long propose la sourdine. */
function ConvRow({ onOpen, actions, children }: { onOpen: () => void; actions: MenuAction[]; children: ReactNode }) {
  const [at, setAt] = useState<Point | null>(null);
  const lp = useLongPress(setAt);
  return (
    <>
      <button
        type="button"
        {...lp}
        onClick={onOpen}
        className="tap flex items-center gap-3 rounded-3xl border-0 bg-transparent p-2.5 text-left text-ink transition-colors select-none hover:bg-soft [-webkit-touch-callout:none]"
      >
        {children}
      </button>
      {at && <ReactionPicker at={at} emojis={[]} current={null} onClose={() => setAt(null)} actions={actions} />}
    </>
  );
}

/** Fiche d'un groupe : nom, membres, ajout d'amis, départ. */
function GroupSheet({ conv, onClose }: { conv: ConversationDetail; onClose: () => void }) {
  const nav = useNavigate();
  const { data: me } = useMe();
  const { data: friends } = useFriends();
  const [title, setTitle] = useState(conv.title ?? '');
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const inGroup = new Set(conv.members.map((m) => m.id));
  const candidates = (friends?.friends ?? []).filter((f) => !inGroup.has(f.id));

  const refresh = (d: ConversationDetail) => {
    qc.setQueryData(['conversation', conv.id], d);
    qc.invalidateQueries({ queryKey: ['conversations'] });
  };

  const rename = async () => {
    setBusy(true);
    try {
      refresh(await api<ConversationDetail>(`/api/conversations/${conv.id}`, { method: 'PATCH', body: { title: title.trim() } }));
      toast('Nom du groupe enregistré');
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    setBusy(true);
    try {
      refresh(await api<ConversationDetail>(`/api/conversations/${conv.id}/members`, { body: { userIds: [...picked] } }));
      toast(picked.size > 1 ? `${picked.size} amis ajoutés` : 'Ami ajouté');
      setPicked(new Set());
      setAdding(false);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (!(await confirmAction({ title: 'Quitter le groupe ?', message: 'Tu ne recevras plus ses messages.', confirmLabel: 'Quitter le groupe', destructive: true }))) return;
    try {
      await api(`/api/conversations/${conv.id}/leave`, { method: 'POST' });
      qc.invalidateQueries({ queryKey: ['conversations'] });
      onClose();
      nav('/messages', { replace: true });
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const toggle = (id: string) => {
    const n = new Set(picked);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setPicked(n);
  };

  return (
    <Sheet title={conversationName(conv, me?.id)} onClose={onClose}>
      <div className="flex gap-2">
        <input className="field flex-1" value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} placeholder="Nom du groupe" />
        <button
          type="button"
          disabled={busy || title.trim() === (conv.title ?? '')}
          onClick={rename}
          className="tap h-12 rounded-3xl border-0 bg-ink px-4 text-sm font-bold text-inv disabled:bg-line disabled:text-mute"
        >
          Renommer
        </button>
      </div>
      <div className="px-1 pt-1 text-[0.8125rem] font-bold tracking-wide text-mute uppercase">
        {conv.members.length} membre{conv.members.length > 1 ? 's' : ''}
      </div>
      <div className="flex flex-col gap-0.5">
        {conv.members.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              onClose();
              nav(m.id === me?.id ? '/profil' : `/u/${m.username}`);
            }}
            className="tap flex items-center gap-3 rounded-3xl border-0 bg-transparent p-2 text-left text-ink hover:bg-soft"
          >
            <Avatar user={m} size={42} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.9375rem] font-bold">{m.id === me?.id ? 'Toi' : m.displayName}</span>
              <span className="block truncate text-[0.8125rem] text-mute">@{m.username}</span>
            </span>
            {conv.createdBy === m.id && <span className="rounded-full bg-soft px-2.5 py-1 text-xs font-bold text-mute">Créateur</span>}
          </button>
        ))}
      </div>
      {adding ? (
        <>
          <div className="px-1 pt-1 text-[0.8125rem] font-bold tracking-wide text-mute uppercase">Ajouter des amis</div>
          {candidates.length === 0 && <div className="px-1 text-sm text-mute">Tous tes amis sont déjà dans le groupe.</div>}
          <div className="flex flex-col gap-0.5">
            {candidates.map((f) => {
              const on = picked.has(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => toggle(f.id)}
                  className={cx('tap flex items-center gap-3 rounded-3xl border-0 p-2 text-left text-ink transition-colors', on ? 'bg-tint' : 'bg-transparent hover:bg-soft')}
                >
                  <Avatar user={f} size={42} />
                  <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-bold">{f.displayName}</span>
                  <CheckCircle size={26} weight={on ? 'fill' : 'regular'} className={on ? 'text-brand' : 'text-line'} />
                </button>
              );
            })}
          </div>
          <PrimaryBtn tone="brand" className="h-[52px] flex-none" disabled={busy || picked.size === 0} onClick={add}>
            Ajouter {picked.size > 0 ? `(${picked.size})` : ''}
          </PrimaryBtn>
        </>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="tap flex h-14 items-center gap-3 rounded-3xl border-0 bg-soft px-4 text-left text-[0.9375rem] font-bold text-acc">
          <UserPlus size={22} /> Ajouter des amis
        </button>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={conv.muted}
        onClick={() => void setMuted(conv.id, !conv.muted)}
        className="tap flex h-14 items-center gap-3 rounded-3xl border-0 bg-soft px-4 text-left text-[0.9375rem] font-bold text-ink"
      >
        <BellSlash size={22} /> <span className="flex-1">Mettre en sourdine</span> <Switch on={conv.muted} />
      </button>
      <button type="button" onClick={leave} className="tap flex h-14 items-center gap-3 rounded-3xl border-0 bg-soft px-4 text-left text-[0.9375rem] font-bold text-heart">
        <SignOut size={22} /> Quitter le groupe
      </button>
    </Sheet>
  );
}

/** Bulle réagissant à l'appui long (téléphone) ou au clic droit (ordinateur). */
/**
 * Bulle : appui long (ou clic droit) = réactions et actions ; glisser vers la droite = répondre.
 */
function Pressable({
  onLong,
  onReply,
  className,
  style,
  children,
}: {
  onLong: (p: Point) => void;
  onReply: () => void;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const lp = useLongPress(onLong);
  const sw = useSwipeX((dir) => dir === 1 && onReply(), { threshold: 56, max: 80 });
  const dx = Math.max(0, sw.dx);
  return (
    <div className="relative">
      <span
        aria-hidden
        className="absolute top-1/2 -left-9 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-soft text-mute"
        style={{ opacity: Math.min(1, dx / 56), transform: `translateY(-50%) scale(${0.6 + Math.min(1, dx / 56) * 0.4})` }}
      >
        <ArrowBendUpLeft size={16} weight="bold" />
      </span>
      <div
        onPointerDown={(e) => {
          lp.onPointerDown(e);
          sw.handlers.onPointerDown(e);
        }}
        onPointerMove={(e) => {
          lp.onPointerMove(e);
          sw.handlers.onPointerMove(e);
        }}
        onPointerUp={() => {
          lp.onPointerUp();
          sw.handlers.onPointerUp();
        }}
        onPointerCancel={() => {
          lp.onPointerCancel();
          sw.handlers.onPointerCancel();
        }}
        onContextMenu={lp.onContextMenu}
        onClickCapture={lp.onClickCapture}
        className={cx('touch-pan-y select-none [-webkit-touch-callout:none]', className)}
        style={{ ...style, transform: dx ? `translateX(${dx}px)` : undefined, transition: dx ? 'none' : 'transform .2s ease' }}
      >
        {children}
      </div>
    </div>
  );
}

/** Trois points animés : quelqu'un écrit. */
function TypingDots() {
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-mute" style={{ animationDelay: `${i * 0.15}s`, animationDuration: '1s' }} />
      ))}
    </span>
  );
}

/** Une conversation par instance : passer d'une conversation à l'autre repart d'un état vide. */
export function Chat() {
  const { id = '' } = useParams();
  return <ChatView key={id} id={id} />;
}

function ChatView({ id }: { id: string }) {
  const nav = useNavigate();
  const goBack = useGoBack();
  const { isPhone } = useViewport();
  const { data: me } = useMe();
  const { data: conv } = useConversation(id);
  const { data: msgs, isLoading } = useMessages(id);
  const [draft, setDraft] = useState('');
  const [info, setInfo] = useState(false);
  const [menu, setMenu] = useState<{ m: Message; at: Point } | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const startReply = (m: Message) => {
    setReplyTo(m);
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  /** Fait défiler jusqu'au message cité et le met en évidence un instant. */
  const showOriginal = (messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) return toast('Message trop ancien pour être affiché', 'error');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 900, iterations: 2 });
  };
  const typingIds = useTyping((s) => s[id]) ?? [];
  const list = useRef<HTMLDivElement | null>(null);

  // On quitte la conversation : on n'écrit plus.
  useEffect(() => () => sendTyping(id, false), [id]);

  // Quelqu'un commence à écrire : on garde l'indicateur visible s'il était déjà en bas.
  useEffect(() => {
    const el = list.current;
    if (el && typingIds.length && el.scrollHeight - el.scrollTop - el.clientHeight < 140) toBottom(true);
  }, [typingIds.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Plein écran sur téléphone : la page ne défile plus, seule la liste des messages défile.
  useLockPageScroll(isPhone);

  const toBottom = (smooth = false) => {
    const el = list.current;
    // Animation seulement sur une courte distance ; de loin, on saute directement.
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth && el.scrollHeight - el.scrollTop - el.clientHeight < 1500 ? 'smooth' : 'auto' });
    setUnseen(0);
  };

  // Suivi du bas de liste : on ne fait défiler automatiquement que si l'on y était déjà.
  const atBottom = useRef(true);
  const [showDown, setShowDown] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const onListScroll = () => {
    const el = list.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    atBottom.current = near;
    setShowDown(!near);
    if (near) setUnseen(0);
    // Près du haut : page précédente (en plus de l'observateur, qui ne tourne pas page masquée).
    if (el.scrollTop < 200) void loadOlderRef.current();
  };
  const loadOlderRef = useRef<() => Promise<void>>(async () => {});

  // Nouveau message en bas : on suit s'il est à moi ou si l'on était en bas, sinon on le compte.
  const lastId = useRef<string | null>(null);
  useEffect(() => {
    const last = msgs?.[msgs.length - 1];
    if (!last || last.id === lastId.current) return;
    const first = lastId.current === null;
    lastId.current = last.id;
    if (first || atBottom.current || last.senderId === me?.id) toBottom(!first);
    else setUnseen((n) => n + 1);
    // Les messages reçus pendant que la conversation est ouverte sont lus.
    if (!first && me && last.senderId !== me.id) {
      api(`/api/conversations/${id}/read`, { method: 'POST' })
        .then(() => qc.invalidateQueries({ queryKey: ['conversations'] }))
        .catch(() => {});
    }
  }, [msgs?.[msgs.length - 1]?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Remonter dans l'historique : on charge la page précédente sans faire sauter la lecture.
  const [hasOlder, setHasOlder] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const keepFrom = useRef<{ height: number; top: number } | null>(null);
  useEffect(() => {
    if (msgs && msgs.length < 100) setHasOlder(false);
  }, [!!msgs]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadOlder = async () => {
    const el = list.current;
    const first = msgs?.[0];
    if (!el || !first || loadingOlder || !hasOlder) return;
    setLoadingOlder(true);
    try {
      const older = await api<Message[]>(`/api/conversations/${id}/messages?before=${first.id}`);
      if (older.length < 100) setHasOlder(false);
      if (older.length) {
        keepFrom.current = { height: el.scrollHeight, top: el.scrollTop };
        qc.setQueryData<Message[]>(['messages', id], (old) => [...older.filter((m) => !old?.some((x) => x.id === m.id)), ...(old ?? [])]);
      }
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setLoadingOlder(false);
    }
  };
  loadOlderRef.current = loadOlder;
  useLayoutEffect(() => {
    const el = list.current;
    if (el && keepFrom.current) {
      el.scrollTop = el.scrollHeight - keepFrom.current.height + keepFrom.current.top;
      keepFrom.current = null;
    }
  }, [msgs?.[0]?.id]);
  const topSentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = topSentinel.current;
    if (!el || !hasOlder) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && void loadOlder(), { root: list.current, rootMargin: '200px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Ouverture du clavier : on garde les derniers messages visibles.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => toBottom();
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [viewing, setViewing] = useState<MediaRef | null>(null);
  const preview = useObjectUrl(file);
  const recorder = useVoiceRecorder(() => void finishVoice(true));
  const picker = useFilePicker('image/*,video/mp4,video/webm,video/quicktime', (f) => {
    if (f.size > 100 * 1024 * 1024) return toast('Fichier trop volumineux (100 Mo max)', 'error');
    setFile(f);
  });

  const append = (m: Message) => {
    qc.setQueryData<Message[]>(['messages', id], (old) => (old && !old.some((x) => x.id === m.id) ? [...old, m] : old));
    qc.invalidateQueries({ queryKey: ['conversations'] });
  };

  /** Envoie un message : texte seul, ou pièce jointe (photo, vidéo, vocal) avec texte facultatif. */
  const sendMessage = async (text: string, attachment: Blob | null, name = 'piece-jointe') => {
    let mediaId: string | undefined;
    if (attachment) {
      setProgress(0);
      const m = await upload<MediaRef>('/api/media', attachment, name, (p) => setProgress(p));
      mediaId = m.id;
    }
    const quoted = replyTo;
    setReplyTo(null);
    try {
      append(await api<Message>(`/api/conversations/${id}/messages`, { body: { text, mediaId, replyToId: quoted?.id } }));
    } catch (e) {
      setReplyTo(quoted);
      throw e;
    }
  };

  const send = async () => {
    const text = draft.trim();
    if ((!text && !file) || progress !== null) return;
    const attachment = file;
    sendTyping(id, false);
    setDraft('');
    setFile(null);
    try {
      await sendMessage(text, attachment, attachment?.name);
    } catch (e) {
      setDraft(text);
      setFile(attachment);
      toast(errMsg(e), 'error');
    } finally {
      setProgress(null);
    }
  };

  const startVoice = async () => {
    try {
      await recorder.start();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const finishVoice = async (keep: boolean) => {
    const blob = await recorder.stop(keep);
    if (!blob) {
      if (keep) toast('Vocal trop court', 'error');
      return;
    }
    try {
      await sendMessage('', blob, voiceFileName(blob));
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setProgress(null);
    }
  };

  /** Ajoute, change ou retire ma réaction (même emoji : retirée). */
  const react = async (m: Message, emoji: string) => {
    const mine = m.reactions.find((r) => me && r.userIds.includes(me.id))?.emoji;
    try {
      const reactions = await api<Message['reactions']>(`/api/messages/${m.id}/reaction`, mine === emoji ? { method: 'DELETE' } : { method: 'PUT', body: { emoji } });
      qc.setQueryData<Message[]>(['messages', id], (old) => old?.map((x) => (x.id === m.id ? { ...x, reactions } : x)));
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  if (isLoading || !me) return <ScreenLoader />;

  const byId = new Map((conv?.members ?? []).map((m) => [m.id, m]));
  const group = !!conv?.isGroup;

  // Accusé de lecture sous mon dernier message, s'il est le dernier de la conversation.
  const lastReal = [...(msgs ?? [])].reverse().find((m) => m.meta?.type !== 'system');
  const seenBy =
    lastReal && lastReal.senderId === me.id
      ? (conv?.reads ?? []).filter((r) => r.at >= lastReal.createdAt && byId.has(r.userId)).map((r) => byId.get(r.userId)!)
      : null;
  const others = (conv?.members ?? []).filter((u) => u.id !== me.id);
  const receipt =
    seenBy === null
      ? null
      : seenBy.length === 0
        ? 'Envoyé'
        : !group
          ? 'Vu'
          : seenBy.length >= others.length
            ? 'Vu par tout le monde'
            : `Vu par ${seenBy.map((u) => u.displayName.split(' ')[0]).join(', ')}`;
  const typers = typingIds.map((uid) => byId.get(uid)).filter((u): u is UserLite => !!u);

  const menuActions = (m: Message): MenuAction[] => {
    const acts: MenuAction[] = [];
    acts.push({ label: 'Répondre', icon: <ArrowBendUpLeft size={18} />, onClick: () => startReply(m) });
    if (m.text) acts.push({ label: 'Copier', icon: <Copy size={18} />, onClick: () => void navigator.clipboard?.writeText(m.text).then(() => toast('Copié')) });
    if (m.senderId === me.id) {
      acts.push({
        label: 'Supprimer pour tout le monde',
        icon: <Trash size={18} />,
        danger: true,
        onClick: async () => {
          if (!(await confirmAction({ title: 'Supprimer ce message ?', message: 'Il disparaîtra pour tout le monde.', confirmLabel: 'Supprimer', destructive: true }))) return;
          try {
            const gone = await api<Message>(`/api/messages/${m.id}`, { method: 'DELETE' });
            qc.setQueryData<Message[]>(['messages', id], (old) => old?.map((x) => (x.id === gone.id ? gone : x)));
            qc.invalidateQueries({ queryKey: ['conversations'] });
          } catch (e) {
            toast(errMsg(e), 'error');
          }
        },
      });
    }
    if (m.senderId !== me.id) {
      const author = byId.get(m.senderId);
      acts.push({
        label: 'Signaler',
        icon: <Flag size={18} />,
        danger: true,
        onClick: () => openReport({ targetType: 'message', targetId: m.id, authorName: author?.displayName.split(' ')[0] }),
      });
    }
    return acts;
  };

  const person = conv && (
    <button
      type="button"
      onClick={() => (group ? setInfo(true) : conv.user && nav(`/u/${conv.user.username}`))}
      className="tap flex min-w-0 flex-1 items-center gap-2.5 border-0 bg-transparent p-0 text-left text-ink"
    >
      <ConvAvatar isGroup={group} user={conv.user} members={conv.members.filter((m) => m.id !== me.id)} size={40} />
      <span className="min-w-0">
        <span className="block truncate text-[1.0625rem] leading-tight font-extrabold">{conversationName(conv, me.id)}</span>
        {group && <span className="block truncate text-xs font-semibold text-mute">{conv.members.length} membres · infos du groupe</span>}
      </span>
      {group && <CaretRight size={16} className="ml-auto flex-none text-mute" />}
    </button>
  );

  const bubbles = (
    <div className="relative flex min-h-0 flex-1 flex-col">
    <div ref={list} onScroll={onListScroll} className="no-scrollbar flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain px-1 py-2">
      <div className="mt-auto" />
      {hasOlder && (
        <div ref={topSentinel} className="flex flex-none justify-center py-2 text-xs font-semibold text-mute" aria-live="polite">
          {loadingOlder ? 'Chargement des anciens messages…' : ''}
        </div>
      )}
      {msgs?.length === 0 && <div className="py-8 text-center text-sm text-mute">Dis bonjour 👋</div>}
      {msgs?.map((m, i) => {
        if (m.meta?.type === 'system') {
          return (
            <div key={m.id} className="my-1 self-center rounded-full bg-glass px-3 py-1 text-center text-xs font-semibold text-mute">
              {m.text}
            </div>
          );
        }
        const mine = m.senderId === me.id;
        if (m.deleted) {
          return (
            <div key={m.id} id={`msg-${m.id}`} className={cx('flex max-w-[82%] flex-none', mine ? 'self-end' : 'self-start')}>
              <span className="rounded-[22px] border border-dashed border-line px-3.5 py-2 text-sm text-mute italic">
                {mine ? 'Tu as supprimé ce message' : 'Message supprimé'}
              </span>
            </div>
          );
        }
        const prev = msgs[i - 1];
        const showSender = group && !mine && (!prev || prev.senderId !== m.senderId || prev.meta?.type === 'system');
        const sender = byId.get(m.senderId);
        const story = m.meta?.type === 'story_reply' ? m.meta : null;
        return (
          <div key={m.id} id={`msg-${m.id}`} className={cx('flex max-w-[82%] flex-none flex-col gap-1', mine ? 'items-end self-end' : 'items-start self-start')}>
            {showSender && (
              <span className="mt-1 flex items-center gap-1.5 pl-1 text-xs font-bold text-mute">
                {sender && <Avatar user={sender} size={20} />}
                {sender?.displayName.split(' ')[0] ?? 'Ancien membre'}
              </span>
            )}
            {story && (
              <div className={cx('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
                <span className="px-1 text-xs font-semibold text-mute">{mine ? 'Tu as répondu à sa story' : 'A répondu à ta story'}</span>
                {story.media && (
                  <div className="ph w-[128px] overflow-hidden rounded-[18px] shadow-pill" style={{ aspectRatio: '3 / 4' }}>
                    {story.media.kind === 'video' && story.media.poster ? (
                      <img src={story.media.poster} alt="Story" className="h-full w-full object-cover" />
                    ) : (
                      <MediaView media={story.media} sizes="128px" />
                    )}
                  </div>
                )}
              </div>
            )}
            <Pressable
              onLong={(at) => setMenu({ m, at })}
              onReply={() => startReply(m)}
              className={cx(
                'animate-in rounded-[22px] text-base leading-[1.4] break-words',
                m.media && m.media.kind !== 'audio' ? 'p-1' : 'px-3.5 py-2.5',
                mine ? 'bg-brand text-white' : 'bg-soft text-ink',
              )}
              style={{ animationDuration: '.35s' }}
            >
              {m.meta?.type === 'reply' && (
                <button
                  type="button"
                  onClick={() => showOriginal((m.meta as { replyTo: { id: string } }).replyTo.id)}
                  className={cx(
                    'tap mb-1.5 block w-full rounded-[14px] border-0 border-l-[3px] border-solid px-2.5 py-1.5 text-left text-[0.8125rem] leading-snug',
                    mine ? 'border-white/70 bg-white/15 text-white' : 'border-brand bg-card/70 text-ink',
                    m.media && m.media.kind !== 'audio' && 'mx-1 mt-1 w-auto',
                  )}
                >
                  <span className="block font-bold">
                    {m.meta.replyTo.senderId === me.id ? 'Toi' : (byId.get(m.meta.replyTo.senderId)?.displayName.split(' ')[0] ?? 'Message')}
                  </span>
                  <span className="line-clamp-2 opacity-85">{m.meta.replyTo.text}</span>
                </button>
              )}
              {m.media?.kind === 'audio' && <VoicePlayer media={m.media} mine={mine} />}
              {m.media && m.media.kind !== 'audio' && <MessagePhotoVideo media={m.media} onOpen={() => setViewing(m.media)} />}
              {m.text && <span className={cx(m.media && m.media.kind !== 'audio' && 'block px-2.5 pt-1.5 pb-1', m.media?.kind === 'audio' && 'mt-1 block')}>{m.text}</span>}
              {m.meta?.type === 'game_invite' && !mine && (
                <button
                  type="button"
                  onClick={() => nav(`/jeu?code=${(m.meta as { code: string }).code}`)}
                  className="tap mt-2 block h-11 rounded-[22px] border-0 bg-brand px-4 text-sm font-bold text-white"
                >
                  Rejoindre le salon
                </button>
              )}
            </Pressable>
            {m.reactions.length > 0 && (
              <div className={cx('-mt-2.5 flex flex-wrap gap-1 px-2', mine ? 'justify-end' : 'justify-start')}>
                {m.reactions.map((r) => {
                  const minePick = r.userIds.includes(me.id);
                  const names = r.userIds.map((uid) => (uid === me.id ? 'toi' : (byId.get(uid)?.displayName.split(' ')[0] ?? '?'))).join(', ');
                  return (
                    <button
                      key={r.emoji}
                      type="button"
                      onClick={() => react(m, r.emoji)}
                      aria-label={`${r.emoji} : ${names}${minePick ? ' (toucher pour retirer)' : ''}`}
                      title={names}
                      className={cx(
                        'tap flex h-7 items-center gap-0.5 rounded-full border-2 border-solid border-card px-1.5 text-[0.9375rem] leading-none shadow-pill',
                        minePick ? 'bg-tint' : 'bg-card',
                      )}
                    >
                      {r.emoji}
                      {r.userIds.length > 1 && <span className="text-xs font-bold text-ink">{r.userIds.length}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            {m.id === lastReal?.id && receipt && (
              <span className="px-1 text-[0.75rem] font-semibold text-mute" aria-live="polite">
                {receipt}
              </span>
            )}
          </div>
        );
      })}
      {typers.length > 0 && (
        <div className="flex flex-none items-end gap-1.5 self-start" aria-live="polite">
          {group && <Avatar user={typers[0]} size={24} />}
          <div className="flex h-10 items-center gap-2 rounded-[22px] bg-soft px-3.5">
            <TypingDots />
            <span className="text-[0.8125rem] font-semibold text-mute">
              {group ? `${typers.map((u) => u.displayName.split(' ')[0]).join(', ')} ${typers.length > 1 ? 'écrivent' : 'écrit'}…` : 'écrit…'}
            </span>
          </div>
        </div>
      )}
    </div>
      {showDown && (
        <button
          type="button"
          onClick={() => toBottom(true)}
          aria-label={unseen ? `${unseen} nouveau${unseen > 1 ? 'x' : ''} message${unseen > 1 ? 's' : ''} : revenir en bas` : 'Revenir en bas'}
          className="tap absolute right-2 bottom-2 flex h-11 min-w-11 animate-pop items-center justify-center gap-1 rounded-full border-0 bg-card px-3 text-sm font-bold text-ink shadow-pill"
        >
          {unseen > 0 && <span className="text-acc">{unseen}</span>}
          <CaretDown size={18} weight="bold" />
        </button>
      )}
    </div>
  );

  const busy = progress !== null;
  const canSend = !!draft.trim() || !!file;
  const round = 'tap grid h-12 w-12 flex-none place-items-center rounded-full border-0 transition-transform active:scale-90';

  const composer = recorder.recording ? (
    <div className="flex flex-none items-center gap-2" role="group" aria-label="Enregistrement d’un message vocal">
      <button type="button" aria-label="Annuler le vocal" onClick={() => void finishVoice(false)} className={cx(round, 'bg-soft text-heart')}>
        <Trash size={20} />
      </button>
      <div className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-3xl bg-soft px-4">
        <span className="h-3 w-3 flex-none animate-pulse rounded-full bg-heart" />
        <span className="text-[0.9375rem] font-bold tabular-nums">{fmtDuration(recorder.elapsed) ?? '0:00'}</span>
        <span className="flex h-6 min-w-0 flex-1 items-center gap-[3px] overflow-hidden" aria-hidden>
          {Array.from({ length: 24 }, (_, i) => (
            <span
              key={i}
              className="w-[3px] flex-none rounded-full bg-brand transition-[height] duration-100"
              style={{ height: `${Math.max(14, Math.min(100, recorder.level * 100 * (0.55 + 0.45 * Math.abs(Math.sin(i * 1.7 + recorder.elapsed)))))}%` }}
            />
          ))}
        </span>
        <span className="hidden text-xs text-mute sm:inline">max {VOICE_MAX_SECONDS / 60} min</span>
      </div>
      <button type="button" aria-label="Envoyer le vocal" onClick={() => void finishVoice(true)} className={cx(round, 'bg-brand text-white shadow-blue')}>
        <PaperPlaneRight size={20} weight="fill" />
      </button>
    </div>
  ) : (
    <div className="flex flex-none flex-col gap-2">
      {picker.input}
      {replyTo && (
        <div className="flex items-center gap-2.5 rounded-[18px] border-0 border-l-[3px] border-solid border-brand bg-soft py-1.5 pr-1.5 pl-3">
          <ArrowBendUpLeft size={18} className="flex-none text-acc" />
          <span className="min-w-0 flex-1">
            <span className="block text-[0.8125rem] font-bold">
              Répondre à {replyTo.senderId === me.id ? 'toi-même' : (byId.get(replyTo.senderId)?.displayName.split(' ')[0] ?? 'ce message')}
            </span>
            <span className="block truncate text-[0.8125rem] text-mute">{replyTo.text || attachmentLabel(replyTo.media?.kind, replyTo.media?.duration)}</span>
          </span>
          <button type="button" aria-label="Annuler la réponse" onClick={() => setReplyTo(null)} className="tap grid h-9 w-9 flex-none place-items-center rounded-full border-0 bg-card text-ink">
            <X size={16} />
          </button>
        </div>
      )}
      {file && preview && (
        <div className="flex items-center gap-2.5 rounded-[22px] bg-soft p-1.5 pr-2">
          <div className="h-14 w-14 flex-none overflow-hidden rounded-[16px] bg-night">
            {file.type.startsWith('video/') ? (
              <video src={preview} muted playsInline className="h-full w-full object-cover" />
            ) : (
              <img src={preview} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {busy ? `Envoi… ${Math.round((progress ?? 0) * 100)} %` : file.type.startsWith('video/') ? 'Vidéo prête à envoyer' : 'Photo prête à envoyer'}
          </span>
          {!busy && (
            <button type="button" aria-label="Retirer la pièce jointe" onClick={() => setFile(null)} className="tap grid h-10 w-10 place-items-center rounded-full border-0 bg-card text-ink">
              <X size={18} />
            </button>
          )}
        </div>
      )}
      {busy && !file && <div className="px-2 text-xs font-semibold text-mute">Envoi du vocal… {Math.round((progress ?? 0) * 100)} %</div>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <button type="button" aria-label="Joindre une photo ou une vidéo" onClick={picker.open} disabled={busy} className={cx(round, 'bg-soft text-ink')}>
          <Paperclip size={20} />
        </button>
        <input
          ref={inputRef}
          className="field min-w-0 flex-1"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            sendTyping(id, !!e.target.value.trim());
          }}
          onBlur={() => sendTyping(id, false)}
          onFocus={() => setTimeout(() => toBottom(), 250)}
          maxLength={1000}
          placeholder={file ? 'Ajoute un texte…' : group ? 'Écris au groupe…' : 'Écris un message…'}
          enterKeyHint="send"
        />
        {canSend || !voiceSupported() ? (
          <button type="submit" aria-label="Envoyer" disabled={busy || !canSend} className={cx(round, 'bg-ink text-inv disabled:opacity-50')}>
            <PaperPlaneRight size={20} weight="fill" />
          </button>
        ) : (
          <button type="button" aria-label="Enregistrer un message vocal" onClick={() => void startVoice()} disabled={busy} className={cx(round, 'bg-brand text-white shadow-blue')}>
            <Microphone size={20} weight="fill" />
          </button>
        )}
      </form>
    </div>
  );

  const sheet = (
    <>
      {info && conv?.isGroup && <GroupSheet conv={conv} onClose={() => setInfo(false)} />}
      {viewing && <MediaLightbox media={viewing} onClose={() => setViewing(null)} />}
      {menu && (
        <ReactionPicker
          at={menu.at}
          emojis={MESSAGE_REACTIONS}
          current={menu.m.reactions.find((r) => r.userIds.includes(me.id))?.emoji ?? null}
          onPick={(e) => void react(menu.m, e)}
          onClose={() => setMenu(null)}
          actions={menuActions(menu.m)}
        />
      )}
    </>
  );

  if (isPhone) {
    // Calé sur la zone visible (au-dessus du clavier) : rien d'autre ne bouge quand on écrit.
    return (
      <>
        <div className="fixed inset-x-0 z-30 flex flex-col" style={{ top: 'var(--vv-top, 0px)', height: 'var(--vvh, 100dvh)' }}>
          <header className="glass-bar flex flex-none items-center gap-2 rounded-b-[28px] px-3 pb-2.5" style={{ paddingTop: 'calc(10px + env(safe-area-inset-top))' }}>
            <button
              type="button"
              aria-label="Retour : Messages"
              onClick={() => goBack('/messages')}
              className="tap grid h-11 w-11 flex-none place-items-center rounded-full border-0 bg-soft text-acc active:scale-95"
            >
              <CaretLeft size={20} weight="bold" />
            </button>
            {person}
          </header>
          <div className="flex min-h-0 flex-1 flex-col px-3">{bubbles}</div>
          <div className="glass-bar flex-none rounded-t-[28px] px-3 pt-2.5" style={{ paddingBottom: 'calc(10px + var(--safe-b))' }}>
            {composer}
          </div>
        </div>
        {sheet}
      </>
    );
  }

  return (
    <div className="card flex h-[calc(100dvh-140px)] min-h-[420px] animate-in flex-col gap-3 p-3" style={{ animationDuration: '.4s' }}>
      <div className="flex flex-none items-center gap-2.5">{person}</div>
      {bubbles}
      {composer}
      {sheet}
    </div>
  );
}
