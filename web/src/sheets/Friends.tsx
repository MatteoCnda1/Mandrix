import type { Friendship, UserLite } from '@mandrix/shared';
import { ChatCircleDots, MagnifyingGlass } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Avatar, Sheet, confirmAction, cx } from '../components/ui';
import { friendAction, openConversation, useFriends, useUserSearch } from '../lib/data';
import { useDebounced } from '../lib/hooks';
import { closeSheet, toast } from '../lib/store';
import { Suggestions } from '../screens/Search';

const small = 'tap h-10 flex-none rounded-[20px] border-0 px-3.5 text-[0.8125rem] font-bold transition-transform active:scale-95';

export function FriendButton({ user, status, className }: { user: UserLite; status: Friendship; className?: string }) {
  const [busy, setBusy] = useState(false);
  const run = async (action: 'add' | 'remove') => {
    setBusy(true);
    const res = await friendAction(user.id, action);
    setBusy(false);
    if (res === 'friends') toast(`Tu es maintenant ami·e avec ${user.displayName}`);
    if (res === 'pending_out') toast('Demande envoyée');
  };
  if (status === 'self') return null;
  const map: Record<Exclude<Friendship, 'self'>, { label: string; cls: string; action: 'add' | 'remove' }> = {
    none: { label: 'Ajouter', cls: 'bg-brand text-white', action: 'add' },
    pending_in: { label: 'Accepter', cls: 'bg-brand text-white', action: 'add' },
    pending_out: { label: 'Demande envoyée', cls: 'bg-soft text-mute', action: 'remove' },
    friends: { label: 'Ami·e ✓', cls: 'bg-soft text-ink', action: 'remove' },
  };
  const m = map[status];
  return (
    <button
      type="button"
      disabled={busy}
      className={cx(small, m.cls, className)}
      onClick={async () => {
        if (status === 'friends' && !(await confirmAction({ title: `Retirer ${user.displayName} de tes amis ?`, confirmLabel: 'Retirer', destructive: true }))) return;
        run(m.action);
      }}
    >
      {m.label}
    </button>
  );
}

export { openConversation } from '../lib/data';

function Row({ user, children }: { user: UserLite; children?: React.ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="flex items-center gap-3 rounded-3xl p-2 transition-colors hover:bg-soft">
      <button
        type="button"
        className="tap flex min-w-0 flex-1 items-center gap-3 border-0 bg-transparent p-0 text-left text-ink"
        onClick={() => {
          closeSheet();
          nav(`/u/${user.username}`);
        }}
      >
        <Avatar user={user} size={44} />
        <span className="min-w-0">
          <span className="block truncate text-[0.9375rem] font-bold">{user.displayName}</span>
          <span className="block truncate text-[0.8125rem] text-mute">@{user.username}</span>
        </span>
      </button>
      {children}
    </div>
  );
}

const Title = ({ children }: { children: React.ReactNode }) => <div className="px-2 pt-2 text-[0.8125rem] font-bold tracking-wide text-mute uppercase">{children}</div>;

export function FriendsSheet() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const { data: friends } = useFriends();
  const { data: results, isFetching } = useUserSearch(dq);

  return (
    <Sheet title="Amis" onClose={closeSheet}>
      <label className="relative flex items-center">
        <MagnifyingGlass size={20} className="pointer-events-none absolute left-4 text-mute" />
        <input className="field w-full pl-12" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un pseudo ou un nom…" autoFocus />
      </label>

      {dq.length >= 2 ? (
        <div className="flex flex-col gap-0.5">
          {isFetching && !results && <div className="py-4 text-center text-sm text-mute">Recherche…</div>}
          {results?.length === 0 && <div className="py-4 text-center text-sm text-mute">Personne trouvé pour « {dq} ».</div>}
          {results?.map((u) => (
            <Row key={u.id} user={u}>
              <FriendButton user={u} status={u.friendship} />
            </Row>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {!!friends?.incoming.length && (
            <>
              <Title>Demandes reçues</Title>
              {friends.incoming.map((u) => (
                <Row key={u.id} user={u}>
                  <button type="button" className={cx(small, 'bg-soft text-ink')} onClick={() => friendAction(u.id, 'remove')}>
                    Refuser
                  </button>
                  <FriendButton user={u} status="pending_in" />
                </Row>
              ))}
            </>
          )}
          {!!friends?.outgoing.length && (
            <>
              <Title>Demandes envoyées</Title>
              {friends.outgoing.map((u) => (
                <Row key={u.id} user={u}>
                  <FriendButton user={u} status="pending_out" />
                </Row>
              ))}
            </>
          )}
          <Suggestions limit={5} onOpen={closeSheet} />
          <Title>Tes amis · {friends?.friends.length ?? 0}</Title>
          {friends?.friends.length === 0 && (
            <div className="px-2 py-3 text-sm text-mute">Cherche tes amis par leur pseudo pour leur envoyer une demande.</div>
          )}
          {friends?.friends.map((u) => (
            <Row key={u.id} user={u}>
              <button type="button" aria-label={`Écrire à ${u.displayName}`} className="tap grid h-10 w-10 place-items-center rounded-full border-0 bg-soft text-ink" onClick={() => openConversation(u.id, nav)}>
                <ChatCircleDots size={20} />
              </button>
            </Row>
          ))}
        </div>
      )}
    </Sheet>
  );
}
