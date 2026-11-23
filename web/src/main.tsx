import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, Suspense, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router';
import { registerSW } from 'virtual:pwa-register';
import { AppLayout } from './components/AppLayout';
import { Backdrop } from './components/Backdrop';
import { ReportHost } from './components/Report';
import { ConfirmHost, Logo, ScreenLoader } from './components/ui';
import { UpdateBanner } from './components/UpdateBanner';
import './index.css';
import { qc, useMe } from './lib/data';
import { preventPinchZoom, useKeyboardViewport } from './lib/keyboard';
import { flushQueue } from './lib/pelliculeQueue';
import { connectSocket, disconnectSocket } from './lib/socket';
import { toast, useUI } from './lib/store';

const toastSent = (n: number) => toast(n > 1 ? `${n} photos en attente envoyées dans ta Pellicule` : 'Photo en attente envoyée dans ta Pellicule');
import { Feed } from './screens/Feed';
import { Landing } from './screens/Landing';

// Écrans chargés à la demande : le fil s'affiche sans attendre le code des autres écrans.
const Camera = lazy(() => import('./screens/Camera').then((m) => ({ default: m.Camera })));
const Game = lazy(() => import('./screens/Game').then((m) => ({ default: m.Game })));
const Memes = lazy(() => import('./screens/Memes').then((m) => ({ default: m.Memes })));
const Messages = lazy(() => import('./screens/Messages').then((m) => ({ default: m.Messages })));
const Chat = lazy(() => import('./screens/Messages').then((m) => ({ default: m.Chat })));
const Moderation = lazy(() => import('./screens/Misc').then((m) => ({ default: m.Moderation })));
const NotificationsPage = lazy(() => import('./screens/Misc').then((m) => ({ default: m.NotificationsPage })));
const PostPage = lazy(() => import('./screens/Misc').then((m) => ({ default: m.PostPage })));
const Profile = lazy(() => import('./screens/Profile').then((m) => ({ default: m.Profile })));
const Reels = lazy(() => import('./screens/Reels').then((m) => ({ default: m.Reels })));
const Search = lazy(() => import('./screens/Search').then((m) => ({ default: m.Search })));
const SettingsPage = lazy(() => import('./screens/Settings').then((m) => ({ default: m.SettingsPage })));
const ResetPassword = lazy(() => import('./screens/ResetPassword').then((m) => ({ default: m.ResetPassword })));
const Admin = lazy(() => import('./screens/Admin').then((m) => ({ default: m.Admin })));
const Unpack = lazy(() => import('./screens/Unpack').then((m) => ({ default: m.Unpack })));

const page = (el: ReactNode) => <Suspense fallback={<ScreenLoader />}>{el}</Suspense>;

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="flex animate-breath flex-col items-center gap-3 [animation-duration:1.6s]">
        <Logo size={64} />
        <div className="font-script text-6xl">Mandrix</div>
      </div>
    </div>
  );
}

/** Garde d'authentification : landing si déconnecté, application sinon. */
function Root() {
  const { data: me, isLoading } = useMe();
  const { pathname, search } = useLocation();
  useKeyboardViewport();

  useEffect(() => {
    if (me) connectSocket();
    else if (me === null) disconnectSocket();
  }, [me]);

  useEffect(() => {
    if (!me) return;
    const flush = async () => {
      if (!navigator.onLine) return;
      const { sent, last } = await flushQueue().catch(() => ({ sent: 0, last: null }));
      if (!sent) return;
      if (last) qc.setQueryData(['pellicule'], last);
      qc.invalidateQueries({ queryKey: ['unpack'] });
      toastSent(sent);
    };
    void flush();
    const onVisible = () => document.visibilityState === 'visible' && void flush();
    window.addEventListener('online', flush);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', flush);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [me]);

  let screen;
  if (isLoading) screen = <Splash />;
  else if (!me) screen = pathname === '/' ? <Landing /> : <Navigate to={`/?next=${encodeURIComponent(pathname + search)}`} replace />;
  else screen = <AppLayout />;
  return (
    <>
      {screen}
      <UpdateBanner />
      <ConfirmHost />
      <ReportHost />
    </>
  );
}

// Notification touchée alors que l'app est ouverte : le service worker demande d'aller à la page.
navigator.serviceWorker?.addEventListener('message', (e) => {
  const data = e.data as { type?: string; path?: string } | null;
  if (data?.type === 'navigate' && data.path?.startsWith('/') && !data.path.startsWith('//')) void router.navigate(data.path);
});

function RedirectAfterLogin() {
  const params = new URLSearchParams(location.search);
  const next = params.get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? <Navigate to={next} replace /> : <Feed />;
}

const router = createBrowserRouter([
  { path: '/reinitialiser', element: page(<ResetPassword />) },
  {
    path: '/',
    element: <Root />,
    children: [
      { index: true, element: <RedirectAfterLogin /> },
      { path: 'reels', element: page(<Reels />) },
      { path: 'pellicule', element: page(<Camera />) },
      { path: 'deballage', element: page(<Unpack />) },
      { path: 'jeu', element: page(<Game />) },
      { path: 'jeu/galerie', element: page(<Memes />) },
      { path: 'profil', element: page(<Profile />) },
      { path: 'u/:username', element: page(<Profile />) },
      { path: 'messages', element: page(<Messages />) },
      { path: 'messages/:id', element: page(<Chat />) },
      { path: 'notifications', element: page(<NotificationsPage />) },
      { path: 'moderation', element: page(<Moderation />) },
      { path: 'p/:id', element: page(<PostPage />) },
      { path: 'recherche', element: page(<Search />) },
      { path: 'reglages', element: page(<SettingsPage />) },
      { path: 'admin', element: page(<Admin />) },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

// Invite d'installation (Android / Chrome / Edge).
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  useUI.setState({ installEvent: e as never });
});

if (import.meta.env.PROD) {
  const updateSW = registerSW({
    immediate: true,
    // Une nouvelle version est téléchargée et attend : on affiche le bouton « Mettre à jour ».
    onNeedRefresh: () => useUI.setState({ updateReady: true }),
    onRegisteredSW: (_url, reg) => {
      if (!reg) return;
      const check = () => {
        if (navigator.onLine) reg.update().catch(() => {});
      };
      setInterval(check, 30 * 60_000);
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
    },
  });
  // Active la version en attente puis recharge la page.
  useUI.setState({ applyUpdate: () => void updateSW(true) });
}

preventPinchZoom();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Backdrop />
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

