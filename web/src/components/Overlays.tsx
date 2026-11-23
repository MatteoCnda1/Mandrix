import { lazy, Suspense } from 'react';
import { useUI } from '../lib/store';

// Feuilles chargées à la première ouverture.
const CommentsSheet = lazy(() => import('../sheets/Comments').then((m) => ({ default: m.CommentsSheet })));
const Composer = lazy(() => import('../sheets/Composer').then((m) => ({ default: m.Composer })));
const EditProfileSheet = lazy(() => import('../sheets/EditProfile').then((m) => ({ default: m.EditProfileSheet })));
const FriendsSheet = lazy(() => import('../sheets/Friends').then((m) => ({ default: m.FriendsSheet })));
const InstallSheet = lazy(() => import('../sheets/Install').then((m) => ({ default: m.InstallSheet })));
const InviteSheet = lazy(() => import('../sheets/Invite').then((m) => ({ default: m.InviteSheet })));
const NewMessageSheet = lazy(() => import('../sheets/NewMessage').then((m) => ({ default: m.NewMessageSheet })));
const PoolSheet = lazy(() => import('../sheets/Pool').then((m) => ({ default: m.PoolSheet })));
const ShareSheet = lazy(() => import('../sheets/Share').then((m) => ({ default: m.ShareSheet })));
const StoryViewer = lazy(() => import('../sheets/StoryViewer').then((m) => ({ default: m.StoryViewer })));

export function Overlays() {
  const composer = useUI((s) => s.composer);
  const commentsFor = useUI((s) => s.commentsFor);
  const poolFor = useUI((s) => s.poolFor);
  const shareFor = useUI((s) => s.shareFor);
  const story = useUI((s) => s.story);
  const sheet = useUI((s) => s.sheet);
  return (
    <Suspense fallback={null}>
      {composer && <Composer key={composer.mode} mode={composer.mode} initialKind={composer.kind} initialPool={composer.pool} />}
      {commentsFor && <CommentsSheet postId={commentsFor} />}
      {poolFor && <PoolSheet target={poolFor} />}
      {shareFor && <ShareSheet post={shareFor} />}
      {story && <StoryViewer key={`${story.group}:${story.index}`} start={story} />}
      {sheet === 'friends' && <FriendsSheet />}
      {sheet === 'editProfile' && <EditProfileSheet />}
      {sheet === 'invite' && <InviteSheet />}
      {sheet === 'newMessage' && <NewMessageSheet />}
      {sheet === 'install' && <InstallSheet />}
    </Suspense>
  );
}
