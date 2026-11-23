import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router';
import { registerSW } from 'virtual:pwa-register';
import { AppLayout } from './components/AppLayout';
import { ConfirmHost, Logo } from './components/ui';
import { UpdateBanner } from './components/UpdateBanner';
import './index.css';
import { qc, useMe } from './lib/data';
import { useKeyboardViewport } from './lib/keyboard';
import { flushQueue } from './lib/pelliculeQueue';
import { connectSocket, disconnectSocket } from './lib/socket';
import { toast, useUI } from './lib/store';

const toastSent = (n: number) => toast(n > 1 ? `${n} photos en attente envoyées dans ta Pellicule` : 'Photo en attente envoyée dans ta Pellicule');
import { Camera } from './screens/Camera';
import { Feed } from './screens/Feed';
import { Game } from './screens/Game';
import { Landing } from './screens/Landing';
import { Memes } from './screens/Memes';
import { Chat, Messages } from './screens/Messages';
import { Moderation, NotificationsPage, PostPage } from './screens/Misc';
import { Profile } from './screens/Profile';
import { Reels } from './screens/Reels';
import { ResetPassword } from './screens/ResetPassword';
import { Unpack } from './screens/Unpack';

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
  const { pathname } = useLocation();
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
  else if (!me) screen = pathname === '/' ? <Landing /> : <Navigate to={`/?next=${encodeURIComponent(pathname)}`} replace />;
  else screen = <AppLayout />;
  return (
    <>
      {screen}
      <UpdateBanner />
      <ConfirmHost />
    </>
  );
}

function RedirectAfterLogin() {
  const params = new URLSearchParams(location.search);
  const next = params.get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? <Navigate to={next} replace /> : <Feed />;
}

const router = createBrowserRouter([
  { path: '/reinitialiser', element: <ResetPassword /> },
  {
    path: '/',
    element: <Root />,
    children: [
      { index: true, element: <RedirectAfterLogin /> },
      { path: 'reels', element: <Reels /> },
      { path: 'pellicule', element: <Camera /> },
      { path: 'deballage', element: <Unpack /> },
      { path: 'jeu', element: <Game /> },
      { path: 'jeu/galerie', element: <Memes /> },
      { path: 'profil', element: <Profile /> },
      { path: 'u/:username', element: <Profile /> },
      { path: 'messages', element: <Messages /> },
      { path: 'messages/:id', element: <Chat /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'moderation', element: <Moderation /> },
      { path: 'p/:id', element: <PostPage /> },
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="aurora" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </div>
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

