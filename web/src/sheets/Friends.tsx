import type { Friendship, MemberCard, UserLite } from '@mandrix/shared';
import { ChatCircleDots, MagnifyingGlass, MapPin } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Avatar, Seg, Sheet, confirmAction, cx } from '../components/ui';
import { friendAction, openConversation, useDirectory, useFriends, useUserSearch } from '../lib/data';
import { useDebounced } from '../lib/hooks';
import { closeSheet, toast } from '../lib/store';
import { Suggestions } from '../screens/Search';

const small = 'tap h-10 flex-none rounded-[20px] border-0 px-3.5 text-[0.8125rem] font-bold transition-transform active:scale-95';

export function FriendButton({ user, status, className, onSoft = false }: { user: UserLite; status: Friendship; className?: string; onSoft?: boolean }) {
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
    // Sur un fond déjà « soft » (cartes des membres), le bouton passe sur le fond des cartes pour rester visible.
    pending_out: { label: 'Demande envoyée', cls: cx(onSoft ? 'bg-card' : 'bg-soft', 'text-mute'), action: 'remove' },
    friends: { label: 'Ami·e ✓', cls: cx(onSoft ? 'bg-card' : 'bg-soft', 'text-ink'), action: 'remove' },
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

/** « Ami·e avec Léa et 2 autres » */
function mutualLine(m: MemberCard) {
  const names = m.mutualPreview.map((u) => u.displayName.split(' ')[0]);
  if (!m.mutual || !names.length) return null;
  const rest = m.mutual - Math.min(names.length, 1);
  return rest > 0 ? `Ami·e avec ${names[0]} et ${rest} autre${rest > 1 ? 's' : ''}` : `Ami·e avec ${names[0]}`;
}

/** Carte d'un membre : photo, présentation, amis en commun, bouton d'ajout (#93). */
function MemberTile({ m }: { m: MemberCard }) {
  const nav = useNavigate();
  const open = () => {
    closeSheet();
    nav(`/u/${m.username}`);
  };
  const mutual = mutualLine(m);
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5 rounded-[26px] bg-soft px-2.5 pt-4 pb-2.5 text-center">
      <button type="button" onClick={open} aria-label={`Voir le profil de ${m.displayName}`} className="tap flex min-w-0 flex-col items-center gap-1.5 border-0 bg-transparent p-0 text-ink">
        <Avatar user={m} size={76} className={cx(m.friendship === 'pending_in' && 'shadow-[0_0_0_3px_var(--color-brand)]')} />
        <span className="mt-1 block max-w-full truncate text-[0.9375rem] leading-tight font-extrabold">{m.displayName}</span>
        <span className="block max-w-full truncate text-[0.8125rem] text-mute">@{m.username}</span>
      </button>
      {m.city && (
        <span className="flex max-w-full items-center gap-1 truncate text-xs font-semibold text-mute">
          <MapPin size={12} weight="fill" className="flex-none" /> {m.city}
        </span>
      )}
      <p className={cx('m-0 line-clamp-2 min-h-[2.5em] text-[0.8125rem] leading-[1.25]', m.bio ? 'text-ink' : 'text-mute italic')}>{m.bio ?? 'Pas encore de présentation'}</p>
      <span className="text-xs font-semibold text-mute">
        {m.posts} post{m.posts > 1 ? 's' : ''} · {m.friends} ami{m.friends > 1 ? 's' : ''}
      </span>
      {mutual && (
        <span className="flex flex-col items-center gap-1 text-xs leading-tight text-mute">
          <span className="flex -space-x-1.5">
            {m.mutualPreview.map((u) => (
              <Avatar key={u.id} user={u} size={20} className="shadow-[0_0_0_2px_var(--color-soft)]" />
            ))}
          </span>
          <span className="line-clamp-2">{mutual}</span>
        </span>
      )}
      <FriendButton user={m} status={m.friendship} onSoft className="mt-auto w-full" />
    </div>
  );
}

/** Tous les membres, façon Instagram : une grille de cartes, recherche et pages. */
function Members() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useDirectory(dq);
  const items = data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <label className="relative flex items-center">
        <MagnifyingGlass size={20} className="pointer-events-none absolute left-4 text-mute" />
        <input className="field w-full pl-12" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher parmi les membres…" aria-label="Rechercher parmi les membres" />
      </label>
      {isLoading && <div className="py-6 text-center text-sm text-mute">Chargement des membres…</div>}
      {!isLoading && items.length === 0 && <div className="py-6 text-center text-sm text-mute">{dq ? `Personne trouvé pour « ${dq} ».` : 'Tu es le premier membre !'}</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((m) => (
          <MemberTile key={m.id} m={m} />
        ))}
      </div>
      {hasNextPage && (
        <button type="button" disabled={isFetchingNextPage} onClick={() => fetchNextPage()} className="tap h-11 self-center rounded-full border-0 bg-soft px-5 text-sm font-bold text-ink disabled:opacity-60">
          {isFetchingNextPage ? 'Chargement…' : 'Voir plus de membres'}
        </button>
      )}
    </>
  );
}

const Title = ({ children }: { children: React.ReactNode }) => <div className="px-2 pt-2 text-[0.8125rem] font-bold tracking-wide text-mute uppercase">{children}</div>;

export function FriendsSheet() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const { data: friends } = useFriends();
  const { data: results, isFetching } = useUserSearch(dq);
  const [tab, setTab] = useState<'amis' | 'membres'>('amis');

  return (
    <Sheet title="Amis" onClose={closeSheet}>
      <Seg
        value={tab}
        onChange={setTab}
        options={[
          { value: 'amis' as const, label: 'Mes amis' },
          { value: 'membres' as const, label: 'Tous les membres' },
        ]}
      />
      {tab === 'membres' ? (
        <Members />
      ) : (
        <>
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
        </>
      )}
    </Sheet>
  );
}
