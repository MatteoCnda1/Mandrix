import type { AdminStats } from '@mandrix/shared';
import { ArrowRight, ChartBar, ShieldCheck } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ScreenLoader, cx } from '../components/ui';
import { api, errMsg } from '../lib/api';
import { useMe } from '../lib/data';
import { fmtCount } from '../lib/format';

const bytes = (n: number) => {
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1).replace('.', ',')} ${units[i]}`;
};

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card flex flex-col gap-0.5 p-4">
      <div className="text-[0.8125rem] font-semibold text-mute">{label}</div>
      <div className="text-[1.75rem] leading-tight font-extrabold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-mute">{sub}</div>}
    </div>
  );
}

/** Tableau de bord de l'admin : membres, contenus, stockage du homelab. */
export function Admin() {
  const nav = useNavigate();
  const { data: me } = useMe();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['admin-stats'], queryFn: () => api<AdminStats>('/api/admin/stats'), enabled: !!me?.isAdmin, refetchInterval: 60_000 });
  if (!me?.isAdmin) return <div className="card p-8 text-center text-mute">Réservé aux administrateurs.</div>;
  if (error && !data)
    return (
      <div className="card flex flex-col items-center gap-3 p-8 text-center text-mute">
        <span>Impossible de charger le tableau de bord : {errMsg(error)}</span>
        <button type="button" className="tap rounded-full border-0 bg-soft px-4 py-2 font-bold text-ink" onClick={() => void refetch()}>
          Réessayer
        </button>
      </div>
    );
  if (isLoading || !data) return <ScreenLoader />;
  const used = data.disk ? data.disk.totalBytes - data.disk.freeBytes : 0;
  const pct = data.disk ? Math.round((used / Math.max(1, data.disk.totalBytes)) * 100) : 0;
  return (
    <div data-screen-label="Administration" className="flex animate-in flex-col gap-3.5">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Membres" value={fmtCount(data.users)} sub={`${fmtCount(data.activeWeek)} actifs cette semaine`} />
        <Stat label="Posts" value={fmtCount(data.posts)} />
        <Stat label="Messages" value={fmtCount(data.messages)} />
        <Stat label="Photos de la Pellicule" value={fmtCount(data.shots)} />
      </div>
      <div className="card flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2 text-[1.0625rem] font-extrabold">
          <ChartBar size={20} weight="fill" className="text-acc" /> Stockage
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-mute">Photos, vidéos et vocaux</span>
          <span className="font-bold tabular-nums">{bytes(data.mediaBytes)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-mute">Base de données</span>
          <span className="font-bold tabular-nums">{bytes(data.databaseBytes)}</span>
        </div>
        {data.disk ? (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-mute">Disque du NAS</span>
              <span className="font-bold tabular-nums">
                {bytes(data.disk.freeBytes)} libres sur {bytes(data.disk.totalBytes)}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-soft" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Disque utilisé">
              <div className={cx('h-full rounded-full', pct > 90 ? 'bg-heart' : pct > 75 ? 'bg-ember' : 'bg-brand')} style={{ width: `${pct}%` }} />
            </div>
          </>
        ) : (
          <div className="rounded-[16px] bg-heart/10 p-3 text-sm font-semibold text-heart">Le NAS ne répond pas : espace disque inconnu.</div>
        )}
      </div>
      <button type="button" onClick={() => nav('/moderation')} className="tap card flex items-center gap-3 border-0 p-4 text-left text-ink">
        <ShieldCheck size={22} className="text-acc" />
        <span className="flex-1 text-[0.9375rem] font-bold">Modération</span>
        <ArrowRight size={18} />
      </button>
    </div>
  );
}
