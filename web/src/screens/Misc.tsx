import { ShieldCheck } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { NotificationList } from '../components/Notifications';
import { PostCard } from '../components/PostCard';
import { Avatar, EmptyCard, MediaView, PrimaryBtn, ScreenLoader } from '../components/ui';
import { api, errMsg } from '../lib/api';
import { qc, useBadges, useMe, usePost, useReports } from '../lib/data';
import { timeAgo } from '../lib/format';
import { toast } from '../lib/store';

export function PostPage() {
  const { id = '' } = useParams();
  const { data, isLoading, error } = usePost(id);
  if (isLoading) return <ScreenLoader />;
  if (error || !data) return <div className="card p-8 text-center text-[15px] text-mute">Ce post n’existe plus.</div>;
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

export function Moderation() {
  const nav = useNavigate();
  const { data: me } = useMe();
  const { data, isLoading } = useReports(!!me?.isAdmin);
  if (!me?.isAdmin) return <div className="card p-8 text-center text-mute">Réservé aux administrateurs.</div>;
  if (isLoading) return <ScreenLoader />;

  const act = async (id: string, action: 'restore' | 'remove') => {
    try {
      await api(action === 'restore' ? `/api/admin/pool/${id}/restore` : `/api/admin/pool/${id}`, { method: action === 'restore' ? 'POST' : 'DELETE' });
      qc.invalidateQueries({ queryKey: ['reports'] });
      toast(action === 'restore' ? 'Image remise dans le pool' : 'Image retirée définitivement du pool');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  if (!data?.length)
    return (
      <EmptyCard icon={<ShieldCheck size={30} weight="fill" />} title="Rien à vérifier" text="Les images signalées par les joueurs de Make It Friends apparaîtront ici.">
        <PrimaryBtn tone="soft" onClick={() => nav('/profil')}>
          Retour au profil
        </PrimaryBtn>
      </EmptyCard>
    );

  return (
    <div className="grid animate-in grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
      {data.map((r) => (
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
  );
}
