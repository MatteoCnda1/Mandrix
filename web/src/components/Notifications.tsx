import type { AppNotification, Badges } from '@mandrix/shared';
import {
  At,
  ChartBar,
  ChatCircle,
  Trophy,
  Fire,
  GameController,
  Heart,
  Lightning,
  LockSimple,
  Package,
  Repeat,
  Sticker,
  UserPlus,
  UsersThree,
} from '@phosphor-icons/react';
import { Fragment, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../lib/api';
import { friendAction, qc, useNotifications, usePellicule } from '../lib/data';
import { countdown, timeAgo } from '../lib/format';
import { useNow } from '../lib/hooks';
import { cx } from './ui';

const WHAT: Record<string, string> = { photo: 'ta photo', video: 'ta vidéo', poll: 'ton sondage', meme: 'ton mème' };

interface Row {
  icon: ReactNode;
  text: ReactNode;
  to?: string;
  action?: { label: string; run: () => void };
}

function describe(n: AppNotification, nav: (to: string) => void): Row {
  const who = <b>{n.actor?.displayName ?? 'Quelqu’un'}</b>;
  const d = n.data as Record<string, string | number | null>;
  const what = WHAT[String(d.kind)] ?? 'ton post';
  switch (n.type) {
    case 'like':
      return { icon: <Heart size={18} weight="fill" className="text-heart" />, text: <>{who} a aimé {what}</>, to: `/p/${d.postId}` };
    case 'comment':
      return { icon: <ChatCircle size={18} weight="fill" className="text-acc" />, text: <>{who} a commenté : « {String(d.text ?? '')} »</>, to: `/p/${d.postId}` };
    case 'repost':
      return { icon: <Repeat size={18} weight="bold" className="text-acc" />, text: <>{who} a republié {what}</>, to: `/p/${d.postId}` };
    case 'friend_request':
      return {
        icon: <UserPlus size={18} weight="fill" className="text-acc" />,
        text: <>{who} veut devenir ton ami·e</>,
        to: n.actor ? `/u/${n.actor.username}` : undefined,
        action: n.actor ? { label: 'Accepter', run: () => friendAction(n.actor!.id, 'add') } : undefined,
      };
    case 'friend_accept':
      return { icon: <UsersThree size={18} weight="fill" className="text-acc" />, text: <>{who} a accepté ta demande</>, to: n.actor ? `/u/${n.actor.username}` : undefined };
    case 'game_invite':
      return {
        icon: <GameController size={18} weight="fill" className="text-acc" />,
        text: <>{who} t’invite dans un salon Make It Friends</>,
        action: { label: 'Rejoindre', run: () => nav(`/jeu?code=${d.code}`) },
      };
    case 'unpack':
      return {
        icon: <Package size={18} weight="fill" className="text-acc" />,
        text: <>Le déballage est ouvert · {String(d.count ?? '')} photos</>,
        action: { label: 'Voir', run: () => nav('/deballage') },
      };
    case 'pool_added':
      return { icon: <Sticker size={18} weight="fill" />, text: <>{who} a envoyé ta photo dans le pool</>, to: d.postId ? `/p/${d.postId}` : '/deballage' };
    case 'pool_drawn':
      return { icon: <Sticker size={18} weight="fill" />, text: <>Ta {d.kind === 'video' ? 'vidéo' : 'photo'} a été tirée {String(d.count)} fois dans le pool</>, to: '/jeu' };
    case 'streak':
      return {
        icon: <Fire size={18} weight="fill" className="text-heart" />,
        text: <>Ta série est en jeu : pense à ta photo avant dimanche</>,
        action: { label: 'Photo', run: () => nav('/pellicule') },
      };
    case 'moment':
      return {
        icon: <Lightning size={18} weight="fill" className="text-ember" />,
        text: <>C’est le moment Mandrix : 10 minutes pour ta photo</>,
        action: { label: 'Photo', run: () => nav('/pellicule') },
      };
    case 'invite_joined':
      return {
        icon: <UserPlus size={18} weight="fill" className="text-acc" />,
        text: <>{who} a rejoint Mandrix grâce à ton code</>,
        to: n.actor ? `/u/${n.actor.username}` : undefined,
      };
    case 'shot_like':
      return { icon: <Heart size={18} weight="fill" className="text-heart" />, text: <>{who} a aimé ta photo de la Pellicule</>, to: '/deballage' };
    case 'reaction': {
      const others = Number(d.others ?? 0);
      return {
        icon: <span className="text-[1.0625rem] leading-none">{String(d.emoji ?? '😍')}</span>,
        text: (
          <>
            {who}
            {others > 0 ? ` et ${others} autre${others > 1 ? 's' : ''}` : ''} {others > 0 ? 'ont' : 'a'} réagi à {what}
          </>
        ),
        to: `/p/${d.postId}`,
      };
    }
    case 'mention':
      return {
        icon: <At size={18} weight="bold" className="text-acc" />,
        text: (
          <>
            {who} t’a mentionné·e {d.where === 'comment' ? 'dans un commentaire' : 'dans un post'} : « {String(d.text ?? '')} »
          </>
        ),
        to: `/p/${d.postId}`,
      };
    case 'poll_ended':
      return {
        icon: <ChartBar size={18} weight="fill" className="text-acc" />,
        text: (
          <>
            Ton sondage « {String(d.question ?? '')} » est terminé. {String(d.result ?? '')}
          </>
        ),
        to: `/p/${d.postId}`,
      };
    case 'birthday':
      return {
        icon: <span className="text-[17px] leading-none">🎂</span>,
        text: <>C’est l’anniversaire de {who} aujourd’hui !</>,
        to: n.actor ? `/u/${n.actor.username}` : undefined,
        action: n.actor ? { label: 'Écrire', run: () => nav(`/u/${n.actor!.username}`) } : undefined,
      };
    case 'alert':
      return {
        icon: <Lightning size={18} weight="fill" className="text-heart" />,
        text: (
          <>
            <b>{String(d.title ?? 'Alerte serveur')}</b> {String(d.body ?? '')}
          </>
        ),
      };
    case 'daily_meme':
      return {
        icon: d.stage === 'won' ? <Trophy size={18} weight="fill" className="text-ember" /> : <Sticker size={18} weight="fill" className="text-acc" />,
        text:
          d.stage === 'won' ? (
            <>Ta légende a gagné le mème du jour avec {String(d.votes)} vote{Number(d.votes) > 1 ? 's' : ''} 🏆</>
          ) : d.stage === 'vote' ? (
            <>Les votes du mème du jour sont ouverts · {String(d.count ?? '')} légendes</>
          ) : (
            <>Le mème du jour est arrivé : écris ta légende</>
          ),
        action: { label: d.stage === 'vote' ? 'Voter' : 'Voir', run: () => nav('/jeu?onglet=jour') },
      };
    default:
      return { icon: <Heart size={18} />, text: <>Nouvelle activité</> };
  }
}

/** « Aujourd'hui », « Cette semaine », « Plus ancien » (heure locale). */
function periodOf(iso: string, now: number) {
  const d = new Date(iso);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (d >= start) return 'Aujourd’hui';
  const week = new Date(start);
  week.setDate(week.getDate() - 6);
  return d >= week ? 'Cette semaine' : 'Plus ancien';
}

/** Marque toutes les notifications comme lues (cloche). */
export async function markAllRead() {
  await api('/api/notifications/read', { method: 'POST' });
  qc.setQueryData<AppNotification[]>(['notifications'], (old) => old?.map((n) => ({ ...n, read: true })));
  qc.setQueryData<Badges>(['badges'], (old) => (old ? { ...old, notifications: 0 } : old));
}

export function NotificationList({ onNavigate }: { onNavigate?: () => void }) {
  const nav = useNavigate();
  const { data, isLoading } = useNotifications();
  const { data: pel } = usePellicule();
  const now = useNow(30_000);
  const cd = countdown(pel?.nextRevealAt, now);
  const go = (to: string) => {
    onNavigate?.();
    nav(to);
  };
  const btn = 'tap h-11 flex-none rounded-[22px] border-0 bg-ink px-3.5 text-[0.8125rem] font-bold text-inv';
  const rowCls = 'flex items-center gap-2.5 rounded-[20px] p-2.5 transition-colors duration-200 hover:bg-soft';

  return (
    <div className="flex flex-col gap-0.5">
      <div className={rowCls}>
        <div className="grid h-10 w-10 flex-none place-items-center rounded-full bg-soft text-acc">
          <LockSimple size={18} weight="fill" />
        </div>
        <div className="min-w-0 flex-1 text-sm leading-[1.35]">
          <div>Déballage de la semaine</div>
          <div className="text-xs text-mute tabular-nums">{cd.line}</div>
        </div>
        <button type="button" className={btn} onClick={() => go('/deballage')}>
          Voir
        </button>
      </div>
      {isLoading && <div className="p-4 text-center text-sm text-mute">Chargement…</div>}
      {data?.length === 0 && <div className="p-4 text-center text-sm text-mute">Rien de neuf pour l’instant.</div>}
      {data?.map((n, idx) => {
        const r = describe(n, go);
        const group = periodOf(n.createdAt, now);
        const header = idx === 0 || periodOf(data[idx - 1].createdAt, now) !== group;
        return (
          <Fragment key={n.id}>
          {header && <div className="px-2.5 pt-3 pb-1 text-xs font-bold tracking-wide text-mute uppercase">{group}</div>}
          <div
            key={n.id}
            className={cx(rowCls, r.to && 'tap')}
            onClick={r.to ? () => go(r.to!) : undefined}
            role={r.to ? 'link' : undefined}
          >
            <div className="relative grid h-10 w-10 flex-none place-items-center rounded-full bg-soft text-ink">
              {r.icon}
              {!n.read && <span className="absolute top-0 right-0 h-2.5 w-2.5 rounded-full bg-brand shadow-[0_0_0_2px_var(--card)]" />}
            </div>
            <div className="min-w-0 flex-1 text-sm leading-[1.35]">
              <div className="line-clamp-2">{r.text}</div>
              <div className="text-xs text-mute tabular-nums">{timeAgo(n.createdAt, now)}</div>
            </div>
            {r.action && (
              <button
                type="button"
                className={btn}
                onClick={(e) => {
                  e.stopPropagation();
                  r.action!.run();
                }}
              >
                {r.action.label}
              </button>
            )}
          </div>
          </Fragment>
        );
      })}
    </div>
  );
}
