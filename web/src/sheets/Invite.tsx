import { CheckCircle, Copy, ShareNetwork } from '@phosphor-icons/react';
import { useState } from 'react';
import { Avatar, PrimaryBtn, Sheet, cx } from '../components/ui';
import { api, errMsg } from '../lib/api';
import { useFriends } from '../lib/data';
import { useGame, useWhois } from '../lib/socket';
import { closeSheet, toast, useUI } from '../lib/store';

export function InviteSheet() {
  const game = useUI((s) => s.inviteGame);
  const mif = useGame((s) => s.room);
  const whois = useWhois((s) => s.room);
  const room = game === 'whois' ? whois : mif;
  const gameName = game === 'whois' ? 'Qui de nous… ?' : 'Make It Friends';
  const { data } = useFriends();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  if (!room) return null;
  const inRoom = new Set(room.players.map((p) => p.user.id));
  const friends = (data?.friends ?? []).filter((f) => !inRoom.has(f.id));

  const toggle = (id: string) => {
    const n = new Set(picked);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setPicked(n);
  };

  const send = async () => {
    setBusy(true);
    try {
      const { sent } = await api<{ sent: number }>('/api/game/invite', { body: { code: room.code, userIds: [...picked] } });
      toast(sent > 1 ? `${sent} invitations envoyées` : 'Invitation envoyée');
      closeSheet();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const link = `${location.origin}/jeu?code=${room.code}`;
  const share = async () => {
    const text = `Rejoins mon salon ${gameName} sur Mandrix : ${room.code}`;
    try {
      if (navigator.share) await navigator.share({ title: gameName, text, url: link });
      else {
        await navigator.clipboard.writeText(link);
        toast('Lien copié');
      }
    } catch {
      /* partage annulé */
    }
  };

  return (
    <Sheet title="Inviter des amis" onClose={closeSheet}>
      <div className="flex items-center gap-2 rounded-[26px] bg-soft p-2 pl-4">
        <span className="font-mono text-[0.9375rem] font-semibold">{room.code}</span>
        <button
          type="button"
          aria-label="Copier le code"
          className="tap ml-auto grid h-10 w-10 place-items-center rounded-full border-0 bg-card text-ink"
          onClick={() => navigator.clipboard?.writeText(room.code).then(() => toast('Code copié'))}
        >
          <Copy size={18} />
        </button>
        <button type="button" aria-label="Partager" className="tap grid h-10 w-10 place-items-center rounded-full border-0 bg-ink text-inv" onClick={share}>
          <ShareNetwork size={18} />
        </button>
      </div>
      {friends.length === 0 && <p className="m-0 px-1 text-sm text-mute">Tous tes amis sont déjà là — ou ajoute-en depuis ton profil.</p>}
      <div className="flex flex-col gap-0.5">
        {friends.map((f) => {
          const on = picked.has(f.id);
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => toggle(f.id)}
              className={cx('tap flex items-center gap-3 rounded-3xl border-0 p-2 text-left text-ink transition-colors', on ? 'bg-tint' : 'bg-transparent hover:bg-soft')}
            >
              <Avatar user={f} size={44} />
              <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-bold">{f.displayName}</span>
              <CheckCircle size={26} weight={on ? 'fill' : 'regular'} className={on ? 'text-brand' : 'text-line'} />
            </button>
          );
        })}
      </div>
      <PrimaryBtn tone="brand" className="h-[54px] flex-none text-base" onClick={send} disabled={busy || picked.size === 0}>
        Envoyer l’invitation
      </PrimaryBtn>
    </Sheet>
  );
}
