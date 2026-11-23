import type { Post, UserProfile } from '@mandrix/shared';
import {
  BellRinging,
  CaretRight,
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
import { Avatar, ScreenLoader, Switch, cx } from '../components/ui';
import { errMsg } from '../lib/api';
import { logout, useConfig, useFriends, useInvite, useMe, useProfile, useReports, useUserPosts } from '../lib/data';
import { currentSubscription, disablePush, enablePush, isStandalone, pushSupported } from '../lib/push';
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

function Tile({ post, ratio }: { post: Post; ratio: string }) {
  const nav = useNavigate();
  return (
    <button
      type="button"
      onClick={() => nav(`/p/${post.id}`)}
      className="tap ph relative grid place-items-center overflow-hidden rounded-[20px] border-0 p-0 font-mono text-xs text-phink transition-[aspect-ratio] duration-[400ms]"
      style={{ aspectRatio: ratio }}
    >
      {post.media?.kind === 'image' && <img src={post.media.url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />}
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
        <span className="flex flex-col items-center gap-1 px-2 text-center font-sans text-[13px] leading-tight font-bold text-ink">
          <ChartBar size={20} />
          <span className="line-clamp-3">{post.text}</span>
        </span>
      )}
      {post.kind === 'meme' && (
        <span className="absolute inset-x-1.5 top-1.5 line-clamp-2 rounded-xl bg-card/90 px-2 py-1 text-center font-sans text-[11px] leading-tight font-extrabold text-ink">{post.text}</span>
      )}
    </button>
  );
}

function Row({ icon, label, onClick, right, danger }: { icon: ReactNode; label: string; onClick: () => void; right?: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('tap flex min-h-14 items-center gap-3 rounded-3xl border-0 bg-transparent px-2 text-left text-[15px] font-bold hover:bg-soft', danger ? 'text-heart' : 'text-ink')}
    >
      <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-soft">{icon}</span>
      <span className="flex-1">{label}</span>
      {right ?? <CaretRight size={18} className="text-mute" />}
    </button>
  );
}

function InviteCard() {
  const { data } = useInvite();
  if (!data) return null;
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
          <div className="text-[13px] text-white/80">
            {data.invited > 0 ? `${data.invited} ami${data.invited > 1 ? 's' : ''} parrainé${data.invited > 1 ? 's' : ''}` : 'Ils deviennent tes amis dès leur inscription'}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-[26px] bg-card p-2 pl-4 text-ink">
        <span className="min-w-0 flex-1 truncate font-mono text-[17px] font-bold tracking-wider">{data.code}</span>
        <button type="button" aria-label="Copier le code" onClick={copy} className="tap grid h-10 w-10 flex-none place-items-center rounded-full border-0 bg-soft text-ink active:scale-90">
          <Copy size={18} />
        </button>
        <button type="button" aria-label="Partager l’invitation" onClick={share} className="tap flex h-10 flex-none items-center gap-1.5 rounded-[20px] border-0 bg-ink px-3.5 text-[13px] font-bold text-inv active:scale-95">
          <ShareNetwork size={18} /> Inviter
        </button>
      </div>
    </div>
  );
}

function Settings() {
  const nav = useNavigate();
  const { data: me } = useMe();
  const { data: config } = useConfig();
  const { data: friends } = useFriends();
  const { data: reports } = useReports(!!me?.isAdmin);
  const installEvent = useUI((s) => s.installEvent);
  const [push, setPush] = useState<boolean | null>(null);

  useEffect(() => {
    currentSubscription().then((s) => setPush(!!s));
  }, []);

  const togglePush = async () => {
    try {
      if (push) {
        await disablePush();
        setPush(false);
        toast('Notifications désactivées');
      } else {
        if (!config?.vapidPublicKey) throw new Error('Notifications push indisponibles sur ce serveur');
        await enablePush(config.vapidPublicKey);
        setPush(true);
        toast('Notifications activées');
      }
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

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
      {(pushSupported() || !isStandalone()) && <Row icon={<BellRinging size={20} />} label="Notifications push" onClick={togglePush} right={<Switch on={!!push} />} />}
      {!isStandalone() && <Row icon={<DownloadSimple size={20} />} label="Installer l’application" onClick={install} />}
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
  const { data: posts, isLoading } = useUserPosts(profile.username, tab);
  const ti = TABS.findIndex((t) => t.id === tab);
  const ratio = tab === 'reels' ? '9 / 14' : '1';

  return (
    <div data-screen-label="Profil" className="flex animate-in flex-col gap-3.5">
      <div className="card flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar user={profile} size={84} ring className="text-[28px] font-extrabold" />
          <div className="min-w-0 flex-[1_1_160px]">
            <div className="truncate text-[22px] font-extrabold tracking-[-.02em]">{profile.displayName}</div>
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
              <FriendButton user={profile} status={profile.friendship} className="h-[46px] rounded-[23px] px-5 text-sm" />
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
            </div>
          )}
        </div>
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
              <div className="text-[22px] font-extrabold">{n as number}</div>
              <div className="text-[13px] text-mute">{l as string}</div>
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
              <div className="text-[13px] text-mute">Au moins une photo par semaine dans la Pellicule</div>
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
      ) : posts?.items.length === 0 ? (
        <div className="card p-8 text-center text-sm text-mute">{tab === 'memes' ? 'Aucun mème publié.' : tab === 'reels' ? 'Aucune vidéo.' : 'Aucun post pour l’instant.'}</div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {posts?.items.map((p) => <Tile key={p.id} post={p} ratio={ratio} />)}
        </div>
      )}
    </div>
  );
}

export function Profile() {
  const { username } = useParams();
  const { data: me } = useMe();
  const target = username ?? me?.username ?? '';
  const { data: profile, isLoading, error } = useProfile(target);
  if (isLoading || !me) return <ScreenLoader />;
  if (error || !profile) return <div className="card p-8 text-center text-[15px] text-mute">Utilisateur introuvable.</div>;
  return <ProfileView key={profile.id} profile={profile} isMe={profile.id === me.id} />;
}
