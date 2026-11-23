import { useUI } from '../lib/store';
import { CommentsSheet } from '../sheets/Comments';
import { Composer } from '../sheets/Composer';
import { EditProfileSheet } from '../sheets/EditProfile';
import { FriendsSheet } from '../sheets/Friends';
import { InstallSheet } from '../sheets/Install';
import { InviteSheet } from '../sheets/Invite';
import { NewMessageSheet } from '../sheets/NewMessage';
import { PoolSheet } from '../sheets/Pool';
import { StoryViewer } from '../sheets/StoryViewer';

export function Overlays() {
  const composer = useUI((s) => s.composer);
  const commentsFor = useUI((s) => s.commentsFor);
  const poolFor = useUI((s) => s.poolFor);
  const story = useUI((s) => s.story);
  const sheet = useUI((s) => s.sheet);
  return (
    <>
      {composer && <Composer key={composer.mode} mode={composer.mode} initialKind={composer.kind} />}
      {commentsFor && <CommentsSheet postId={commentsFor} />}
      {poolFor && <PoolSheet target={poolFor} />}
      {story && <StoryViewer start={story} />}
      {sheet === 'friends' && <FriendsSheet />}
      {sheet === 'editProfile' && <EditProfileSheet />}
      {sheet === 'invite' && <InviteSheet />}
      {sheet === 'newMessage' && <NewMessageSheet />}
      {sheet === 'install' && <InstallSheet />}
    </>
  );
}
