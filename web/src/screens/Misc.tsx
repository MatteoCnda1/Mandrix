import type { ModerationCase } from '@mandrix/shared';
import { ShieldCheck } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { NotificationList } from '../components/Notifications';
import { PostCard } from '../components/PostCard';
import { Avatar, confirmAction, cx, EmptyCard, MediaView, PrimaryBtn, ScreenLoader } from '../components/ui';
import { api, errMsg } from '../lib/api';
import { qc, useBadges, useMe, usePost, useReports } from '../lib/data';
import { timeAgo } from '../lib/format';
import { toast } from '../lib/store';

export function PostPage() {
  const { id = '' } = useParams();
  const { data, isLoading, error } = usePost(id);
  if (isLoading) return <ScreenLoader />;
  if (error || !data) return <div className="card p-8 text-center text-[0.9375rem] text-mute">Ce post n’existe plus.</div>;
  return <PostCard post={data} />;
}

export function NotificationsPage() {
  const { data: badges } = useBadges();
  useEffect(() => {
    if (badges?.notifications) {
      api('/api/notifications/read', { method: 'POST' }).then(() => qc.setQueryData(['badges'], { ...badges, notifications: 0 }));
    }
  }, [badges?.notifications]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="card animate-in p-2.5">
      <NotificationList />
    </div>
  );
}

const TYPE_LABEL: Record<ModerationCase['targetType'], string> = { post: 'Post', comment: 'Commentaire', story: 'Story', message: 'Message', user: 'Compte' };

/** File des signalements (posts, commentaires, stories, messages, comptes). */
function ReportQueue() {
  const nav = useNavigate();
  const { data } = useQuery({ queryKey: ['moderation'], queryFn: () => api<ModerationCase[]>('/api/admin/moderation') });
  if (!data?.length) return null;

  const resolve = async (c: ModerationCase, action: 'dismiss' | 'hide' | 'delete') => {
    if (action === 'delete' && !(await confirmAction({ title: 'Supprimer ce contenu ?', confirmLabel: 'Supprimer', destructive: true }))) return;
    try {
      await api('/api/admin/moderation/resolve', { body: { targetType: c.targetType, targetId: c.targetId, action } });
      qc.invalidateQueries({ queryKey: ['moderation'] });
      toast(action === 'dismiss' ? 'Signalement classé' : action === 'hide' ? 'Contenu masqué' : 'Contenu supprimé');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const suspend = async (c: ModerationCase) => {
    if (!c.author) return;
    const on = !c.authorSuspended;
    if (on && !(await confirmAction({ title: `Suspendre @${c.author.username} ?`, message: 'Ses sessions sont fermées et la connexion lui est refusée.', confirmLabel: 'Suspendre', destructive: true }))) return;
    try {
      await api(`/api/admin/users/${c.author.id}/suspend`, { method: on ? 'POST' : 'DELETE' });
      qc.invalidateQueries({ queryKey: ['moderation'] });
      toast(on ? 'Compte suspendu' : 'Compte réactivé');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="m-0 px-2 text-[0.8125rem] font-bold tracking-wide text-mute uppercase">Signalements · {data.length}</h2>
      {data.map((c) => (
        <article key={`${c.targetType}:${c.targetId}`} className="card flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-soft px-2.5 py-1 text-xs font-bold">{TYPE_LABEL[c.targetType]}</span>
            {c.hidden && <span className="rounded-full bg-heart/15 px-2.5 py-1 text-xs font-bold text-heart">Masqué</span>}
            {c.authorSuspended && <span className="rounded-full bg-heart px-2.5 py-1 text-xs font-bold text-white">Compte suspendu</span>}
            <span className="ml-auto text-xs text-mute">
              {c.reports} signalement{c.reports > 1 ? 's' : ''} · {timeAgo(c.createdAt)}
            </span>
          </div>
          {c.author && (
            <button type="button" onClick={() => nav(`/u/${c.author!.username}`)} className="tap flex items-center gap-2 border-0 bg-transparent p-0 text-left text-ink">
              <Avatar user={c.author} size={30} />
              <span className="text-sm font-bold">{c.author.displayName}</span>
              <span className="text-sm text-mute">@{c.author.username}</span>
            </button>
          )}
          {c.media && (
            <div className="ph aspect-[4/3] max-w-[320px] overflow-hidden rounded-[20px]">
              <MediaView media={c.media} controls={c.media.kind === 'video'} sizes="320px" />
            </div>
          )}
          {c.text && <p className="m-0 rounded-[18px] bg-soft p-3 text-[0.9375rem] whitespace-pre-line">{c.text}</p>}
          <div className="text-[0.8125rem] text-mute">
            Motifs : {c.reasons.join(', ')} · par {c.reporters.map((u) => u.displayName.split(' ')[0]).join(', ')}
          </div>
          <div className="flex flex-wrap gap-2">
            {c.url && (
              <PrimaryBtn tone="soft" className="h-11 text-sm" onClick={() => nav(c.url!)}>
                Ouvrir
              </PrimaryBtn>
            )}
            <PrimaryBtn tone="soft" className="h-11 text-sm" onClick={() => resolve(c, 'dismiss')}>
              Classer
            </PrimaryBtn>
            {c.targetType !== 'user' && c.targetType !== 'message' && !c.hidden && (
              <PrimaryBtn tone="soft" className="h-11 text-sm" onClick={() => resolve(c, 'hide')}>
                Masquer
              </PrimaryBtn>
            )}
            {c.targetType !== 'user' && (
              <PrimaryBtn tone="danger" className="h-11 text-sm" onClick={() => resolve(c, 'delete')}>
                Supprimer
              </PrimaryBtn>
            )}
            {c.author && (
              <PrimaryBtn tone={c.authorSuspended ? 'soft' : 'danger'} className={cx('h-11 text-sm')} onClick={() => suspend(c)}>
                {c.authorSuspended ? 'Réactiver le compte' : 'Suspendre le compte'}
              </PrimaryBtn>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}

export function Moderation() {
  const nav = useNavigate();
  const { data: me } = useMe();
  const { data, isLoading } = useReports(!!me?.isAdmin);
  const cases = useQuery({ queryKey: ['moderation'], queryFn: () => api<ModerationCase[]>('/api/admin/moderation'), enabled: !!me?.isAdmin });
  if (!me?.isAdmin) return <div className="card p-8 text-center text-mute">Réservé aux administrateurs.</div>;
  if (isLoading || cases.isLoading) return <ScreenLoader />;

  const act = async (id: string, action: 'restore' | 'remove') => {
    try {
      await api(action === 'restore' ? `/api/admin/pool/${id}/restore` : `/api/admin/pool/${id}`, { method: action === 'restore' ? 'POST' : 'DELETE' });
      qc.invalidateQueries({ queryKey: ['reports'] });
      toast(action === 'restore' ? 'Image remise dans le pool' : 'Image retirée définitivement du pool');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  if (!data?.length && !cases.data?.length)
    return (
      <EmptyCard icon={<ShieldCheck size={30} weight="fill" />} title="Rien à vérifier" text="Les contenus et comptes signalés, ainsi que les images signalées dans Make It Friends, apparaîtront ici.">
        <PrimaryBtn tone="soft" onClick={() => nav('/profil')}>
          Retour au profil
        </PrimaryBtn>
      </EmptyCard>
    );

  return (
    <div className="flex animate-in flex-col gap-5">
      <ReportQueue />
      {!!data?.length && <h2 className="m-0 px-2 text-[0.8125rem] font-bold tracking-wide text-mute uppercase">Images du pool signalées · {data.length}</h2>}
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
      {data?.map((r) => (
        <div key={r.id} className="card flex flex-col gap-2.5 p-3">
          <div className="ph aspect-[4/3] overflow-hidden rounded-[20px]">
            <MediaView media={r.media} controls={r.media.kind === 'video'} />
          </div>
          <div className="flex items-center gap-2 px-1">
            <Avatar user={r.owner} size={30} />
            <span className="min-w-0 flex-1 truncate text-sm font-bold">@{r.owner.username}</span>
            <span className="text-xs text-mute">
              {r.reports} signalement{r.reports > 1 ? 's' : ''} · {timeAgo(r.createdAt)}
            </span>
          </div>
          <div className="flex gap-2">
            <PrimaryBtn tone="soft" className="h-11 flex-1 text-sm" onClick={() => act(r.id, 'restore')}>
              Remettre
            </PrimaryBtn>
            <PrimaryBtn tone="danger" className="h-11 flex-1 text-sm" onClick={() => act(r.id, 'remove')}>
              Retirer
            </PrimaryBtn>
          </div>
        </div>
      ))}
    </div>
    </div>
  );
}
