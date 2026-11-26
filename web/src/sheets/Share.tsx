import { conversationName, type Post, type ShareResult, type UserLite } from '@mandrix/shared';
import { CheckCircle, MagnifyingGlass } from '@phosphor-icons/react';
import { useState } from 'react';
import { ConvAvatar } from '../components/ConvAvatar';
import { SharedPostCard } from '../components/SharedPost';
import { PrimaryBtn, Sheet, cx } from '../components/ui';
import { api, errMsg } from '../lib/api';
import { qc, useConversations, useFriends, useMe } from '../lib/data';
import { toast, useUI } from '../lib/store';

type Target = { key: string; kind: 'conv' | 'user'; id: string; name: string; sub: string; avatar: React.ReactNode };

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const close = () => useUI.setState({ shareFor: null });

/** Envoyer un post en message (#73) : conversations récentes, groupes compris, puis les autres amis. */
export function ShareSheet({ post }: { post: Post }) {
  const { data: me } = useMe();
  const { data: convs } = useConversations();
  const { data: friends } = useFriends();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const inDm = new Set((convs ?? []).filter((c) => !c.isGroup && c.user).map((c) => c.user!.id));
  const targets: Target[] = [
    ...(convs ?? []).map((c) => ({
      key: `c:${c.id}`,
      kind: 'conv' as const,
      id: c.id,
      name: conversationName(c, me?.id),
      sub: c.isGroup ? `${c.members.length + 1} membres` : `@${c.user?.username ?? ''}`,
      avatar: <ConvAvatar isGroup={c.isGroup} user={c.user} members={c.members} photo={c.photo} size={44} />,
    })),
    ...(friends?.friends ?? [])
      .filter((f: UserLite) => !inDm.has(f.id))
      .map((f) => ({
        key: `u:${f.id}`,
        kind: 'user' as const,
        id: f.id,
        name: f.displayName,
        sub: `@${f.username}`,
        avatar: <ConvAvatar isGroup={false} user={f} members={[]} size={44} />,
      })),
  ];
  const needle = norm(q.trim());
  const shown = needle ? targets.filter((t) => norm(`${t.name} ${t.sub}`).includes(needle)) : targets;

  const toggle = (key: string) => {
    const n = new Set(picked);
    if (n.has(key)) n.delete(key);
    else if (n.size < 20) n.add(key);
    else toast('20 destinataires au plus', 'error');
    setPicked(n);
  };

  const send = async () => {
    if (!picked.size || busy) return;
    setBusy(true);
    const chosen = targets.filter((t) => picked.has(t.key));
    try {
      const res = await api<ShareResult>(`/api/posts/${post.id}/share`, {
        body: {
          conversationIds: chosen.filter((t) => t.kind === 'conv').map((t) => t.id),
          userIds: chosen.filter((t) => t.kind === 'user').map((t) => t.id),
          text: text.trim(),
        },
      });
      qc.invalidateQueries({ queryKey: ['conversations'] });
      for (const id of res.sent) qc.invalidateQueries({ queryKey: ['messages', id] });
      if (res.refused.length) {
        const who = res.refused.slice(0, 3).join(', ') + (res.refused.length > 3 ? '…' : '');
        toast(res.sent.length ? `Envoyé, sauf à ${who} : ce post ne leur est pas visible` : `Pas envoyé : ce post n’est pas visible pour ${who}`, 'error');
      } else toast(res.sent.length > 1 ? `Envoyé dans ${res.sent.length} conversations` : 'Envoyé');
      if (res.sent.length) close();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Envoyer à…" onClose={close}>
      <div className="flex justify-center [&>button]:shadow-pill">
        <SharedPostCard post={{ id: post.id, kind: post.kind, author: post.author, text: post.text, media: post.media, anonymous: post.anonymous }} mine={false} />
      </div>
      {targets.length === 0 ? (
        <p className="m-0 px-1 text-sm text-mute">Ajoute des amis pour leur envoyer des posts.</p>
      ) : (
        <>
          {targets.length > 6 && (
            <label className="relative flex items-center">
              <MagnifyingGlass size={20} className="pointer-events-none absolute left-4 text-mute" />
              <input className="field w-full pl-12" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" aria-label="Rechercher une conversation ou un ami" />
            </label>
          )}
          <div className="flex flex-col gap-0.5">
            {shown.map((t) => {
              const on = picked.has(t.key);
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => toggle(t.key)}
                  aria-pressed={on}
                  className={cx('tap flex items-center gap-3 rounded-3xl border-0 p-2 text-left text-ink transition-colors', on ? 'bg-tint' : 'bg-transparent hover:bg-soft')}
                >
                  {t.avatar}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] font-bold">{t.name}</span>
                    <span className="block truncate text-[0.8125rem] text-mute">{t.sub}</span>
                  </span>
                  <CheckCircle size={26} weight={on ? 'fill' : 'regular'} className={on ? 'text-brand' : 'text-line'} />
                </button>
              );
            })}
            {shown.length === 0 && <p className="m-0 px-2 py-3 text-sm text-mute">Personne ne correspond.</p>}
          </div>
          <input className="field" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Ajouter un message (facultatif)" aria-label="Message" />
          <PrimaryBtn disabled={!picked.size || busy} onClick={send}>
            {busy ? 'Envoi…' : picked.size > 1 ? `Envoyer (${picked.size})` : 'Envoyer'}
          </PrimaryBtn>
        </>
      )}
    </Sheet>
  );
}
