import { GROUP_MAX_MEMBERS } from '@mandrix/shared';
import { CheckCircle, MagnifyingGlass, UsersThree } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Avatar, PrimaryBtn, Sheet, cx } from '../components/ui';
import { api, errMsg } from '../lib/api';
import { qc, useFriends } from '../lib/data';
import { closeSheet, openSheet, toast } from '../lib/store';
import { openConversation } from './Friends';

/** Nouveau message : un ami = conversation privée, plusieurs amis = groupe. */
export function NewMessageSheet() {
  const nav = useNavigate();
  const { data } = useFriends();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const friends = data?.friends ?? [];
  const needle = q.trim().toLowerCase();
  const shown = needle ? friends.filter((f) => f.displayName.toLowerCase().includes(needle) || f.username.includes(needle)) : friends;
  const group = picked.length >= 2;

  const toggle = (id: string) => {
    if (picked.includes(id)) setPicked(picked.filter((x) => x !== id));
    else if (picked.length < GROUP_MAX_MEMBERS - 1) setPicked([...picked, id]);
    else toast(`Un groupe compte ${GROUP_MAX_MEMBERS} membres maximum`, 'error');
  };

  const start = async () => {
    if (picked.length === 0) return;
    if (!group) return openConversation(picked[0], nav);
    setBusy(true);
    try {
      const { id } = await api<{ id: string }>('/api/conversations', { body: { userIds: picked, title: title.trim() || undefined } });
      qc.invalidateQueries({ queryKey: ['conversations'] });
      closeSheet();
      nav(`/messages/${id}`);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const one = friends.find((f) => f.id === picked[0]);

  return (
    <Sheet title="Nouveau message" onClose={closeSheet}>
      {friends.length === 0 ? (
        <div className="flex flex-col items-start gap-3 px-1 text-sm text-mute">
          Tu peux écrire à tes amis. Commence par en ajouter !
          <button type="button" className="tap h-11 rounded-[22px] border-0 bg-ink px-4 text-sm font-bold text-inv" onClick={() => openSheet('friends')}>
            Trouver des amis
          </button>
        </div>
      ) : (
        <>
          <p className="m-0 px-1 text-[13px] text-mute">Choisis un ami pour discuter à deux, ou plusieurs pour créer un groupe.</p>
          {friends.length > 6 && (
            <label className="relative flex items-center">
              <MagnifyingGlass size={20} className="pointer-events-none absolute left-4 text-mute" />
              <input className="field w-full pl-12" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un ami…" />
            </label>
          )}
          <div className="flex flex-col gap-0.5">
            {shown.map((f) => {
              const on = picked.includes(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => toggle(f.id)}
                  aria-pressed={on}
                  className={cx('tap flex items-center gap-3 rounded-3xl border-0 p-2 text-left text-ink transition-colors', on ? 'bg-tint' : 'bg-transparent hover:bg-soft')}
                >
                  <Avatar user={f} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold">{f.displayName}</span>
                    <span className="block truncate text-[13px] text-mute">@{f.username}</span>
                  </span>
                  <CheckCircle size={26} weight={on ? 'fill' : 'regular'} className={on ? 'text-brand' : 'text-line'} />
                </button>
              );
            })}
          </div>
          {group && (
            <label className="relative flex items-center">
              <UsersThree size={20} className="pointer-events-none absolute left-4 text-mute" />
              <input className="field w-full pl-12" value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} placeholder="Nom du groupe (facultatif)" />
            </label>
          )}
          <PrimaryBtn tone={group ? 'brand' : 'ink'} className="h-[54px] flex-none text-base" disabled={busy || picked.length === 0} onClick={start}>
            {picked.length === 0 ? 'Choisis un ou plusieurs amis' : group ? `Créer le groupe (${picked.length + 1})` : `Écrire à ${one?.displayName.split(' ')[0] ?? ''}`}
          </PrimaryBtn>
        </>
      )}
    </Sheet>
  );
}
