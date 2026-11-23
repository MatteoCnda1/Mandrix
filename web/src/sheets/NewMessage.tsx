import { useNavigate } from 'react-router';
import { Avatar, Sheet } from '../components/ui';
import { useFriends } from '../lib/data';
import { closeSheet, openSheet } from '../lib/store';
import { openConversation } from './Friends';

export function NewMessageSheet() {
  const nav = useNavigate();
  const { data } = useFriends();
  const friends = data?.friends ?? [];
  return (
    <Sheet title="Nouveau message" onClose={closeSheet}>
      {friends.length === 0 && (
        <div className="flex flex-col items-start gap-3 px-1 text-sm text-mute">
          Tu peux écrire à tes amis. Commence par en ajouter !
          <button type="button" className="tap h-11 rounded-[22px] border-0 bg-ink px-4 text-sm font-bold text-inv" onClick={() => openSheet('friends')}>
            Trouver des amis
          </button>
        </div>
      )}
      <div className="flex flex-col gap-0.5">
        {friends.map((f) => (
          <button key={f.id} type="button" onClick={() => openConversation(f.id, nav)} className="tap flex items-center gap-3 rounded-3xl border-0 bg-transparent p-2 text-left text-ink hover:bg-soft">
            <Avatar user={f} size={44} />
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-bold">{f.displayName}</span>
              <span className="block truncate text-[13px] text-mute">@{f.username}</span>
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
