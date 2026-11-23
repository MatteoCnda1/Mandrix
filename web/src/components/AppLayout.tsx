import { Bell, CaretLeft, Camera, ChatCircleDots, GameController, House, LockSimple, Moon, Package, Play, Plus, Sun, User } from '@phosphor-icons/react';
import { useEffect, useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { qc, useBadges, usePellicule, usePoolStats } from '../lib/data';
import { countdown } from '../lib/format';
import { useNow } from '../lib/hooks';
import { useUI } from '../lib/store';
import { useDark, useViewport } from '../lib/theme';
import { NotificationList } from './Notifications';
import { Overlays } from './Overlays';
import { cx, Logo, Toast } from './ui';

type IconC = ComponentType<{ size?: number; weight?: 'regular' | 'fill' | 'bold' }>;

const NAV: { to: string; icon: IconC; label: string; long: string; match: string[] }[] = [
  { to: '/', icon: House, label: 'Fil', long: 'Pour toi', match: ['/', '/p/'] },
  { to: '/reels', icon: Play, label: 'Reels', long: 'Reels', match: ['/reels'] },
  { to: '/pellicule', icon: Camera, label: 'Pellicule', long: 'La Pellicule', match: ['/pellicule', '/deballage'] },
  { to: '/jeu', icon: GameController, label: 'Jeu', long: 'Make It Friends', match: ['/jeu'] },
  { to: '/profil', icon: User, label: 'Profil', long: 'Profil', match: ['/profil', '/u/', '/moderation'] },
];

/** Titre de l'écran et destination du bouton « retour » (navigation hiérarchique, HIG). */
const ROUTES: { prefix: string; title: string; back?: string | -1; backLabel?: string }[] = [
  { prefix: '/reels', title: 'Reels' },
  { prefix: '/pellicule', title: 'La Pellicule' },
  { prefix: '/deballage', title: 'Déballage', back: '/pellicule', backLabel: 'Pellicule' },
  { prefix: '/jeu/galerie', title: 'Galerie des mèmes', back: '/jeu', backLabel: 'Jeu' },
  { prefix: '/jeu', title: 'Make It Friends' },
  { prefix: '/profil', title: 'Profil' },
  { prefix: '/u/', title: 'Profil', back: -1, backLabel: 'Retour' },
  { prefix: '/messages/', title: 'Discussion', back: '/messages', backLabel: 'Messages' },
  { prefix: '/messages', title: 'Messages', back: -1, backLabel: 'Retour' },
  { prefix: '/notifications', title: 'Notifications', back: -1, backLabel: 'Retour' },
  { prefix: '/moderation', title: 'Modération', back: '/profil', backLabel: 'Profil' },
  { prefix: '/p/', title: 'Post', back: -1, backLabel: 'Retour' },
];

const routeInfo = (path: string) => (path === '/' ? { prefix: '/', title: 'Pour toi' } : (ROUTES.find((r) => path.startsWith(r.prefix)) ?? { prefix: path, title: '' }));

const isActive = (path: string, match: string[]) => match.some((m) => (m === '/' ? path === '/' : path.startsWith(m)));

function SideNav({ desktop }: { desktop: boolean }) {
  const { pathname } = useLocation();
  return (
    <nav className="sticky top-6 flex flex-none flex-col gap-2.5 self-start" aria-label="Navigation principale">
      <div className="mb-2 flex h-14 items-center gap-3 px-1.5">
        <Logo size={42} />
        {desktop && <div className="pr-2 font-script text-[40px] leading-none">Mandrix</div>}
      </div>
      {NAV.map((n) => {
        const active = isActive(pathname, n.match);
        const Icon = n.icon;
        return (
          <NavLink
            key={n.to}
            to={n.to}
            aria-label={n.long}
            className={cx(
              'tap flex h-[54px] items-center gap-3 rounded-[27px] px-4 text-[15px] font-bold no-underline shadow-pill transition-[background,color,transform] duration-300 hover:translate-x-[3px] active:scale-[.96]',
              active ? 'bg-ink text-inv hover:text-inv' : 'bg-glass text-ink hover:text-ink',
            )}
          >
            <Icon size={22} weight={active ? 'fill' : 'regular'} />
            {desktop && <span className="pr-1.5">{n.long}</span>}
          </NavLink>
        );
      })}
    </nav>
  );
}

function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav
      className="glass-bar kb-hide fixed left-1/2 z-20 flex w-[min(440px,calc(100vw-20px))] -translate-x-1/2 gap-0.5 rounded-[34px] p-1.5"
      style={{ bottom: 'calc(10px + env(safe-area-inset-bottom))' }}
      aria-label="Navigation principale"
    >
      {NAV.map((n) => {
        const active = isActive(pathname, n.match);
        const Icon = n.icon;
        return (
          <NavLink
            key={n.to}
            to={n.to}
            aria-label={n.long}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'tap relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-[3px] rounded-[28px] no-underline transition-colors duration-300 active:scale-95',
              active ? 'text-acc hover:text-acc' : n.to === '/pellicule' ? 'text-azure hover:text-azure' : 'text-ink hover:text-ink',
            )}
          >
            <span
              className="absolute inset-0 rounded-[28px] bg-ink/[.08] transition-opacity duration-300 dark:bg-white/10"
              style={{ opacity: active ? 1 : 0 }}
            />
            <Icon size={24} weight={active ? 'fill' : 'regular'} />
            <span className="relative text-[11px] leading-none font-bold">{n.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

function Header({ isPhone }: { isPhone: boolean }) {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [dark, toggleDark] = useDark();
  const { data: badges } = useBadges();
  const info = routeInfo(pathname);
  const goBack = () => {
    if (info.back === -1) {
      if ((window.history.state as { idx?: number } | null)?.idx) nav(-1);
      else nav('/');
    } else if (info.back) nav(info.back);
  };
  const round = 'tap grid h-[46px] w-[46px] place-items-center rounded-full border-0 transition-transform duration-200 active:scale-[.94]';

  useEffect(() => setOpen(false), [pathname]);

  const toggleNotifs = () => {
    const next = !open;
    setOpen(next);
    if (next && badges?.notifications) {
      api('/api/notifications/read', { method: 'POST' }).then(() => {
        qc.setQueryData(['badges'], { ...badges, notifications: 0 });
        setTimeout(() => qc.invalidateQueries({ queryKey: ['notifications'] }), 1500);
      });
    }
  };

  return (
    <header className="relative z-[25] mb-3.5 flex h-14 items-center gap-2.5">
      {info.back ? (
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={goBack}
            aria-label={`Retour : ${info.backLabel}`}
            className="tap flex h-11 flex-none items-center gap-0.5 rounded-[22px] border-0 bg-card/70 pr-3.5 pl-2 text-[15px] font-bold text-acc shadow-pill backdrop-blur active:scale-95"
          >
            <CaretLeft size={20} weight="bold" />
            {!isPhone && <span>{info.backLabel}</span>}
          </button>
          <h1 className="m-0 truncate text-[22px] font-extrabold tracking-[-.03em] sm:text-[28px]">{info.title}</h1>
        </div>
      ) : isPhone && pathname === '/' ? (
        <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="tap flex items-center gap-1 border-0 bg-transparent p-0 text-ink" aria-label="Mandrix, revenir en haut">
          <Logo size={40} />
          <div className="ml-1 font-script text-4xl leading-none">Mandrix</div>
        </button>
      ) : (
        <h1 className="m-0 min-w-0 truncate text-[26px] font-extrabold tracking-[-.03em] sm:text-[28px]">{info.title}</h1>
      )}
      <div className="ml-auto flex gap-2">
        {!(isPhone && info.back) && (
        <button
          type="button"
          aria-label="Créer un post"
          onClick={() => useUI.getState().openComposer('post')}
          className={cx(round, 'bg-brand text-white shadow-blue transition-transform duration-300 ease-spring hover:rotate-90 active:scale-90')}
        >
          <Plus size={22} />
        </button>
        )}
        <button type="button" aria-label="Messages" onClick={() => nav('/messages')} className={cx(round, 'relative bg-card text-ink shadow-pill')}>
          <ChatCircleDots size={20} />
          {!!badges?.messages && <span className="absolute top-[9px] right-[9px] h-2.5 w-2.5 rounded-full bg-heart shadow-[0_0_0_2px_var(--card)]" />}
        </button>
        <button
          type="button"
          aria-label="Notifications"
          aria-expanded={open}
          onClick={toggleNotifs}
          className="tap flex h-[46px] items-center gap-1.5 rounded-[23px] border-0 bg-card px-[13px] text-sm font-bold text-ink shadow-pill transition-transform duration-200 active:scale-[.94]"
        >
          <Bell size={20} />
          {!!badges?.notifications && <span>{badges.notifications > 99 ? '99+' : badges.notifications}</span>}
        </button>
        {!isPhone && (
          <button type="button" aria-label="Mode sombre" onClick={toggleDark} className={cx(round, 'bg-card text-ink shadow-pill')}>
            {dark ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        )}
      </div>
      {open && (
        <>
          <div className="fixed inset-0" onClick={() => setOpen(false)} />
          <div className="absolute top-[62px] right-0 flex max-h-[70vh] w-[min(390px,100%)] origin-top-right animate-drop flex-col gap-0.5 overflow-auto rounded-[28px] bg-card p-2.5 shadow-menu">
            <div className="flex items-center px-2.5 py-2">
              <div className="text-[17px] font-extrabold">Notifications</div>
              <button type="button" className="tap ml-auto border-0 bg-transparent text-[13px] font-bold text-acc" onClick={() => nav('/notifications')}>
                Tout voir
              </button>
            </div>
            <NotificationList onNavigate={() => setOpen(false)} />
          </div>
        </>
      )}
    </header>
  );
}

function Aside() {
  const nav = useNavigate();
  const { data: pel } = usePellicule();
  const { data: pool } = usePoolStats();
  const now = useNow(1000);
  const cd = countdown(pel?.nextRevealAt, now);
  const tile = 'rounded-[18px] bg-card py-2.5 text-center text-ink';
  return (
    <aside className="sticky top-6 flex w-[300px] flex-none flex-col gap-3.5 self-start pt-[70px]">
      <div className="flex flex-col gap-3.5 rounded-[32px] bg-brand p-[18px] text-white shadow-blue">
        <div className="flex items-center gap-2 text-[17px] font-extrabold">
          <LockSimple size={20} weight="fill" />
          <span>La Pellicule</span>
        </div>
        <div className="grid grid-cols-4 gap-1.5 tabular-nums">
          {[
            [cd.d, 'jours'],
            [cd.h, 'h'],
            [cd.m, 'min'],
            [cd.s, 's'],
          ].map(([v, l]) => (
            <div key={l} className={tile}>
              <div className="text-[22px] font-extrabold">{v}</div>
              <div className="text-xs text-mute">{l}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => nav('/pellicule')} className="tap h-[46px] flex-1 rounded-[23px] border-0 bg-ink text-sm font-bold text-inv active:scale-95">
            Prendre une photo
          </button>
          <button type="button" aria-label="Déballage" onClick={() => nav('/deballage')} className="tap grid h-[46px] w-[46px] place-items-center rounded-full border-0 bg-card text-ink active:scale-90">
            <Package size={20} />
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-3 rounded-[32px] bg-hero p-[18px] text-white shadow-hero">
        <div className="text-[26px] leading-none font-extrabold tracking-[-.05em]">Make It Friends</div>
        <div className="text-sm text-fog">{(pool?.publicCount ?? 0).toLocaleString('fr-FR')} photos et vidéos dans le pool public.</div>
        <button type="button" onClick={() => nav('/jeu')} className="tap h-[46px] rounded-[23px] border-0 bg-white text-sm font-bold text-night active:scale-95">
          Jouer
        </button>
        <button type="button" onClick={() => nav('/jeu/galerie')} className="tap h-[46px] rounded-[23px] border-0 bg-white/15 text-sm font-bold text-white active:scale-95">
          Galerie des mèmes
        </button>
      </div>
    </aside>
  );
}

export function AppLayout() {
  const { isPhone, isDesktop } = useViewport();
  const { pathname } = useLocation();
  const wide = pathname.startsWith('/deballage') || pathname.startsWith('/jeu/galerie');
  // Conversation sur téléphone : plein écran comme Messages d'iOS (sans en-tête ni onglets).
  const immersive = isPhone && /^\/messages\/[^/]+/.test(pathname);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="min-h-dvh font-sans text-ink" style={{ ['--toast-bottom' as string]: isPhone ? '92px' : '28px' }}>
      <div
        className="mx-auto flex max-w-[1320px] justify-center gap-7"
        style={{ padding: 'clamp(12px,2.4vw,24px)', paddingTop: 'calc(clamp(12px,2.4vw,24px) + env(safe-area-inset-top))' }}
      >
        {!isPhone && <SideNav desktop={isDesktop} />}
        <main className="min-w-0 flex-1 pb-[110px]" style={{ maxWidth: wide ? 860 : 620 }}>
          {!immersive && <Header isPhone={isPhone} />}
          <Outlet />
        </main>
        {isDesktop && <Aside />}
      </div>
      {isPhone && !immersive && <BottomNav />}
      <Overlays />
      <Toast />
    </div>
  );
}
