import { retroYear, type Post, type UserProfile } from '@mandrix/shared';
import {
  CaretRight,
  DotsThree,
  PushPin,
  Flag,
  Confetti,
  GearSix,
  Prohibit,
  Key,
  QrCode,
  Stack,
  ChatCircleDots,
  ChartBar,
  Copy,
  DownloadSimple,
  Gift,
  Fire,
  LockSimple,
  Moon,
  Play,
  ShareNetwork,
  ShieldCheck,
  SignOut,
  Sun,
  UsersThree,
} from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ReactionPicker } from '../components/Reactions';
import { openReport } from '../components/Report';
import { Avatar, PrimaryBtn, PullIndicator, ScreenLoader, Sheet, Switch, confirmAction, cx } from '../components/ui';
import { api, errMsg } from '../lib/api';
import { logout, qc, useFriends, useInvite, useMe, useProfile, useReports, useUserPosts } from '../lib/data';
import { useSwipeX } from '../lib/gestures';
import { usePullToRefresh, type Point } from '../lib/hooks';
import { isStandalone } from '../lib/push';
import { disconnectSocket } from '../lib/socket';
import { openSheet, toast, useUI } from '../lib/store';
import { useDark } from '../lib/theme';
import { FriendButton, openConversation } from '../sheets/Friends';

type Tab = 'posts' | 'reels' | 'memes';
const TABS: { id: Tab; label: string }[] = [
  { id: 'posts', label: 'Posts' },
  { id: 'reels', label: 'Reels' },
  { id: 'memes', label: 'Mèmes' },
];

function Tile({ post, ratio, pinned = false }: { post: Post; ratio: string; pinned?: boolean }) {
  const nav = useNavigate();
  return (
    <button
      type="button"
      onClick={() => nav(`/p/${post.id}`)}
      className="tap ph relative grid place-items-center overflow-hidden rounded-[20px] border-0 p-0 font-mono text-xs text-phink transition-[aspect-ratio] duration-[400ms]"
      style={{ aspectRatio: ratio }}
    >
      {post.media?.kind === 'image' && <img src={post.media.url} srcSet={post.media.srcSet ?? undefined} sizes="(max-width: 700px) 34vw, 220px" alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />}
      {pinned && (
        <span className="absolute top-2 left-2 z-[1] grid h-7 w-7 place-items-center rounded-full bg-black/45 text-white" aria-label="Post épinglé">
          <PushPin size={15} weight="fill" />
        </span>
      )}
      {post.gallery && (
        <span className="absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-full bg-black/45 text-white" aria-label={`${post.gallery.length} photos`}>
          <Stack size={15} weight="fill" />
        </span>
      )}
      {post.media?.kind === 'video' && (
        <>
          {post.media.poster ? (
            <img src={post.media.poster} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
          ) : !post.media.processing ? (
            <video src={`${post.media.url}#t=0.1`} muted playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover" />
          ) : null}
          <Play size={22} weight="fill" className="absolute top-2 right-2 text-white drop-shadow" />
        </>
      )}
      {post.kind === 'poll' && (
        <span className="flex flex-col items-center gap-1 px-2 text-center font-sans text-[0.8125rem] leading-tight font-bold text-ink">
          <ChartBar size={20} />
          <span className="line-clamp-3">{post.text}</span>
        </span>
      )}
      {post.kind === 'meme' && (
        <span className="absolute inset-x-1.5 top-1.5 line-clamp-2 rounded-xl bg-card/90 px-2 py-1 text-center font-sans text-[0.6875rem] leading-tight font-extrabold text-ink">{post.text}</span>
      )}
    </button>
  );
}

function Row({ icon, label, onClick, right, danger }: { icon: ReactNode; label: string; onClick: () => void; right?: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('tap flex min-h-14 items-center gap-3 rounded-3xl border-0 bg-transparent px-2 text-left text-[0.9375rem] font-bold hover:bg-soft', danger ? 'text-heart' : 'text-ink')}
    >
      <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-soft">{icon}</span>
      <span className="flex-1">{label}</span>
      {right ?? <CaretRight size={18} className="text-mute" />}
    </button>
  );
}

/** Carte de parrainage (code, lien, QR code) : seulement pour les membres autorisés à parrainer. */
function InviteCard() {
  const { data: me } = useMe();
  const { data } = useInvite(!!me?.canInvite);
  const [qr, setQr] = useState(false);
  if (!me?.canInvite || !data) return null;
  const copy = () => navigator.clipboard?.writeText(data.code).then(() => toast('Code copié'));
  const share = async () => {
    const text = `Rejoins-moi sur Mandrix ! Mon code de parrainage : ${data.code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Mandrix', text, url: data.link });
      else {
        await navigator.clipboard.writeText(`${text}\n${data.link}`);
        toast('Lien d’invitation copié');
      }
    } catch {
      /* partage annulé */
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-[32px] bg-brand p-[18px] text-white shadow-blue">
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 flex-none place-items-center rounded-full bg-card text-acc">
          <Gift size={22} weight="fill" />
        </span>
        <div className="min-w-0">
          <div className="text-lg font-extrabold">Parraine tes amis</div>
          <div className="text-[0.8125rem] text-white/80">
            {data.invited > 0 ? `${data.invited} ami${data.invited > 1 ? 's' : ''} parrainé${data.invited > 1 ? 's' : ''}` : 'Ils deviennent tes amis dès leur inscription'}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-[26px] bg-card p-2 pl-4 text-ink">
        <span className="min-w-0 flex-1 truncate font-mono text-[1.0625rem] font-bold tracking-wider">{data.code}</span>
        <button type="button" aria-label="Copier le code" onClick={copy} className="tap grid h-10 w-10 flex-none place-items-center rounded-full border-0 bg-soft text-ink active:scale-90">
          <Copy size={18} />
        </button>
        <button type="button" aria-label="Afficher le QR code" onClick={() => setQr(true)} className="tap grid h-10 w-10 flex-none place-items-center rounded-full border-0 bg-soft text-ink active:scale-90">
          <QrCode size={18} />
        </button>
        <button type="button" aria-label="Partager l’invitation" onClick={share} className="tap flex h-10 flex-none items-center gap-1.5 rounded-[20px] border-0 bg-ink px-3.5 text-[0.8125rem] font-bold text-inv active:scale-95">
          <ShareNetwork size={18} /> Inviter
        </button>
      </div>
      {qr && <QrSheet link={data.link} code={data.code} onClose={() => setQr(false)} />}
    </div>
  );
}

/** QR code du lien de parrainage, pour inviter en face à face. */
function QrSheet({ link, code, onClose }: { link: string; code: string; onClose: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    // Bibliothèque chargée à la demande (elle n'alourdit pas le reste de l'app).
    void import('qrcode').then((QR) => QR.toDataURL(link, { width: 560, margin: 1, color: { dark: '#0b0f14', light: '#ffffff' } }).then(setSrc));
  }, [link]);
  return (
    <Sheet title="Inviter avec un QR code" onClose={onClose}>
      <div className="flex flex-col items-center gap-3 pb-2">
        <div className="grid aspect-square w-[min(280px,70vw)] place-items-center rounded-[28px] bg-white p-3 shadow-pill">
          {src ? <img src={src} alt={`QR code du lien d’invitation (code ${code})`} className="h-full w-full" /> : <span className="text-sm text-mute">Préparation…</span>}
        </div>
        <div className="font-mono text-lg font-bold tracking-wider">{code}</div>
        <p className="m-0 text-center text-[0.9375rem] text-mute">Ton ami scanne le code avec l’appareil photo de son téléphone : il arrive sur l’inscription avec ton parrainage.</p>
      </div>
    </Sheet>
  );
}

function Settings() {
  const nav = useNavigate();
  const { data: me } = useMe();
  const { data: friends } = useFriends();
  const { data: reports } = useReports(!!me?.isAdmin);
  const installEvent = useUI((s) => s.installEvent);

  const install = async () => {
    if (installEvent) {
      await installEvent.prompt();
      useUI.setState({ installEvent: null });
    } else openSheet('install');
  };

  return (
    <div className="card flex flex-col gap-0.5 p-2.5">
      <Row
        icon={<UsersThree size={20} />}
        label="Amis"
        onClick={() => openSheet('friends')}
        right={friends?.incoming.length ? <span className="rounded-full bg-brand px-2.5 py-1 text-xs font-extrabold text-white">{friends.incoming.length}</span> : undefined}
      />
      <Row icon={<GearSix size={20} />} label="Réglages" onClick={() => nav('/reglages')} />
      <Row icon={<Confetti size={20} />} label={retroYear() ? `Ma rétro ${retroYear()}` : 'Mon année jusqu’ici'} onClick={() => nav('/retro')} />
      {!isStandalone() && <Row icon={<DownloadSimple size={20} />} label="Installer l’application" onClick={install} />}
      {me?.isAdmin && <Row icon={<ChartBar size={20} />} label="Administration" onClick={() => nav('/admin')} />}
      {me?.isAdmin && (
        <Row
          icon={<ShieldCheck size={20} />}
          label="Modération"
          onClick={() => nav('/moderation')}
          right={reports?.length ? <span className="rounded-full bg-heart px-2.5 py-1 text-xs font-extrabold text-white">{reports.length}</span> : undefined}
        />
      )}
      <Row
        icon={<SignOut size={20} />}
        label="Se déconnecter"
        danger
        onClick={async () => {
          disconnectSocket();
          await logout();
          nav('/', { replace: true });
        }}
        right={<span />}
      />
    </div>
  );
}

function ProfileView({ profile, isMe }: { profile: UserProfile; isMe: boolean }) {
  const nav = useNavigate();
  const [dark, toggleDark] = useDark();
  const [tab, setTab] = useState<Tab>('posts');
  const [menu, setMenu] = useState<Point | null>(null);
  const { pull, refreshing } = usePullToRefresh(() =>
    Promise.all([qc.invalidateQueries({ queryKey: ['profile'] }), qc.invalidateQueries({ queryKey: ['user-posts'] }), qc.invalidateQueries({ queryKey: ['friends'] })]),
  );

  const refresh = () => {
    for (const k of [['profile'], ['friends'], ['feed'], ['stories'], ['user-posts'], ['blocks'], ['conversations']]) qc.invalidateQueries({ queryKey: k });
  };
  const block = async () => {
    const ok = await confirmAction({
      title: `Bloquer ${profile.displayName} ?`,
      message: 'Vous ne serez plus amis, vous ne verrez plus vos contenus et ne pourrez plus vous écrire. Tu peux débloquer à tout moment dans Réglages.',
      confirmLabel: 'Bloquer',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api(`/api/users/${profile.id}/block`, { method: 'POST' });
      toast(`${profile.displayName} est bloqué·e`);
      refresh();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  const { data: me } = useMe();
  const [resetLink, setResetLink] = useState<string | null>(null);
  const makeResetLink = async () => {
    try {
      setResetLink((await api<{ link: string }>(`/api/admin/users/${profile.id}/reset-link`, { method: 'POST' })).link);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  const unblock = async () => {
    try {
      await api(`/api/users/${profile.id}/block`, { method: 'DELETE' });
      toast(`${profile.displayName} est débloqué·e`);
      refresh();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  const { data: posts, isLoading } = useUserPosts(profile.username, tab);
  const ti = TABS.findIndex((t) => t.id === tab);
  const tabSwipe = useSwipeX((dir) => setTab(TABS[Math.min(TABS.length - 1, Math.max(0, ti - dir))].id), { threshold: 60 });
  const ratio = tab === 'reels' ? '9 / 14' : '1';

  return (
    <div data-screen-label="Profil" className="flex animate-in flex-col gap-3.5">
      <PullIndicator pull={pull} refreshing={refreshing} />
      <div className="card flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar user={profile} size={84} ring className="text-[1.75rem] font-extrabold" />
          <div className="min-w-0 flex-[1_1_160px]">
            <div className="truncate text-[1.375rem] font-extrabold tracking-[-.02em]">{profile.displayName}</div>
            <div className="truncate text-sm text-mute">
              @{profile.username}
              {profile.city ? ` · ${profile.city}` : ''}
            </div>
          </div>
          {isMe ? (
            <button type="button" onClick={() => openSheet('editProfile')} className="tap h-[46px] rounded-[23px] border-0 bg-ink px-5 text-sm font-bold text-inv active:scale-95">
              Modifier
            </button>
          ) : (
            <div className="flex gap-2">
              {!profile.blockedByMe && <FriendButton user={profile} status={profile.friendship} className="h-[46px] rounded-[23px] px-5 text-sm" />}
              {profile.friendship === 'friends' && (
                <button
                  type="button"
                  aria-label="Envoyer un message"
                  onClick={() => openConversation(profile.id, nav)}
                  className="tap grid h-[46px] w-[46px] place-items-center rounded-full border-0 bg-soft text-ink"
                >
                  <ChatCircleDots size={20} />
                </button>
              )}
              <button
                type="button"
                aria-label="Plus d’options"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setMenu({ x: r.left + r.width / 2, y: r.bottom + 60 });
                }}
                className="tap grid h-[46px] w-[46px] place-items-center rounded-full border-0 bg-soft text-ink"
              >
                <DotsThree size={22} />
              </button>
            </div>
          )}
        </div>
        {resetLink && (
          <Sheet title="Lien de réinitialisation" onClose={() => setResetLink(null)}>
            <p className="m-0 text-[0.9375rem] text-mute">
              Envoie ce lien à {profile.displayName.split(' ')[0]} : il permet de choisir un nouveau mot de passe, une seule fois, pendant 1 heure. Toutes ses sessions seront fermées.
            </p>
            <div className="rounded-[18px] bg-soft p-3 font-mono text-xs break-all select-all">{resetLink}</div>
            <div className="grid grid-cols-2 gap-2">
              <PrimaryBtn tone="soft" onClick={() => void navigator.clipboard?.writeText(resetLink).then(() => toast('Lien copié'))}>
                Copier
              </PrimaryBtn>
              <PrimaryBtn onClick={() => void navigator.share?.({ title: 'Mandrix', text: 'Ton lien pour choisir un nouveau mot de passe Mandrix', url: resetLink }).catch(() => {})}>
                Partager
              </PrimaryBtn>
            </div>
          </Sheet>
        )}
        {profile.blockedByMe && (
          <div className="flex items-center gap-3 rounded-[22px] bg-soft p-3.5">
            <Prohibit size={22} className="flex-none text-heart" />
            <span className="flex-1 text-sm font-semibold">Tu as bloqué @{profile.username}.</span>
            <button type="button" onClick={() => void unblock()} className="tap h-10 rounded-[20px] border-0 bg-card px-3.5 text-[0.8125rem] font-bold text-ink">
              Débloquer
            </button>
          </div>
        )}
        {menu && (
          <ReactionPicker
            at={menu}
            emojis={[]}
            current={null}
            onClose={() => setMenu(null)}
            actions={[
              profile.blockedByMe
                ? { label: 'Débloquer', icon: <Prohibit size={18} />, onClick: () => void unblock() }
                : { label: 'Bloquer', icon: <Prohibit size={18} />, danger: true, onClick: () => void block() },
              {
                label: 'Signaler le compte',
                icon: <Flag size={18} />,
                danger: true,
                onClick: () => openReport({ targetType: 'user', targetId: profile.id }),
              },
              ...(me?.isAdmin
                ? [{ label: 'Lien de réinitialisation', icon: <Key size={18} />, onClick: () => void makeResetLink() }]
                : []),
            ]}
          />
        )}
        {profile.bio && <p className="m-0 text-base leading-[1.45]">{profile.bio}</p>}
        <div className="grid grid-cols-3 gap-2">
          {[
            [profile.stats.posts, 'Posts', undefined],
            [profile.stats.friends, 'Amis', isMe ? () => openSheet('friends') : undefined],
            [profile.stats.memesWon, 'Mèmes gagnés', undefined],
          ].map(([n, l, onClick]) => (
            <button
              key={l as string}
              type="button"
              onClick={onClick as (() => void) | undefined}
              className={cx('rounded-[22px] border-0 bg-soft px-3.5 py-3 text-left text-ink', onClick ? 'tap' : 'cursor-default')}
            >
              <div className="text-[1.375rem] font-extrabold">{n as number}</div>
              <div className="text-[0.8125rem] text-mute">{l as string}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3.5">
        <div className="card flex flex-col gap-3.5 p-[18px]">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 flex-none place-items-center rounded-full bg-brand text-white">
              <Fire size={22} weight="fill" />
            </span>
            <div>
              <div className="text-lg font-extrabold">
                Série de {profile.streak.weeks} semaine{profile.streak.weeks > 1 ? 's' : ''}
              </div>
              <div className="text-[0.8125rem] text-mute">Au moins une photo par semaine dans la Pellicule</div>
            </div>
          </div>
          <div className="flex gap-1.5">
            {profile.streak.history.map((on, i) => (
              <div key={i} className={cx('h-2.5 flex-1 rounded-[5px]', on ? 'bg-brand' : 'bg-line')} />
            ))}
          </div>
        </div>
        {isMe && (
          <button type="button" onClick={toggleDark} className="tap card flex items-center gap-3 border-0 p-[18px] text-left text-ink">
            <span className="grid h-12 w-12 flex-none place-items-center rounded-full bg-soft">{dark ? <Sun size={22} /> : <Moon size={22} />}</span>
            <span className="flex-1 text-lg font-extrabold">Mode sombre</span>
            <Switch on={dark} />
          </button>
        )}
      </div>

      {isMe && <InviteCard />}
      {isMe && <Settings />}

      <div className="relative grid grid-cols-3 rounded-[28px] bg-glass p-1">
        <div
          className="absolute top-1 bottom-1 left-1 rounded-3xl bg-ink transition-transform duration-[450ms] ease-[cubic-bezier(.3,1.2,.4,1)]"
          style={{ width: 'calc((100% - 8px) / 3)', transform: `translateX(${ti * 100}%)` }}
        />
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cx('tap relative h-[46px] rounded-3xl border-0 bg-transparent text-sm font-bold transition-colors duration-300', t.id === tab ? 'text-inv' : 'text-ink')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* Glisser à gauche / à droite sur la grille : onglet suivant ou précédent. */}
      <div {...tabSwipe.handlers} className="touch-pan-y" style={{ transform: tabSwipe.dx ? `translateX(${tabSwipe.dx * 0.35}px)` : undefined, transition: tabSwipe.dx ? 'none' : 'transform .2s ease' }}>
        {posts?.locked ? (
          <div className="card flex flex-col items-center gap-2 p-8 text-center">
            <LockSimple size={28} weight="fill" className="text-acc" />
            <div className="font-extrabold">Profil réservé aux amis</div>
            <div className="text-sm text-mute">Ajoute @{profile.username} en ami pour voir ses posts.</div>
          </div>
        ) : isLoading ? (
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="skel rounded-[20px]" style={{ aspectRatio: ratio }} />
            ))}
          </div>
        ) : posts?.items.length === 0 && !posts.pinned ? (
          <div className="card p-8 text-center text-sm text-mute">{tab === 'memes' ? 'Aucun mème publié.' : tab === 'reels' ? 'Aucune vidéo.' : 'Aucun post pour l’instant.'}</div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {posts?.pinned && <Tile key={posts.pinned.id} post={posts.pinned} ratio={ratio} pinned />}
            {posts?.items.map((p) => <Tile key={p.id} post={p} ratio={ratio} />)}
          </div>
        )}
      </div>
    </div>
  );
}

export function Profile() {
  const { username } = useParams();
  const { data: me } = useMe();
  const target = username ?? me?.username ?? '';
  const { data: profile, isLoading, error } = useProfile(target);
  if (isLoading || !me) return <ScreenLoader />;
  if (error || !profile) return <div className="card p-8 text-center text-[0.9375rem] text-mute">Utilisateur introuvable.</div>;
  return <ProfileView key={profile.id} profile={profile} isMe={profile.id === me.id} />;
}
