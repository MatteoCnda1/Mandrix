import type { Message } from '@mandrix/shared';
import { ChatCircleDots, PaperPlaneRight, PencilSimple } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Avatar, EmptyCard, PrimaryBtn, ScreenLoader, cx } from '../components/ui';
import { api, errMsg } from '../lib/api';
import { qc, useConversation, useConversations, useMe, useMessages } from '../lib/data';
import { shortTime } from '../lib/format';
import { useNow } from '../lib/hooks';
import { openSheet, toast } from '../lib/store';

export function Messages() {
  const nav = useNavigate();
  const { data, isLoading } = useConversations();
  const now = useNow(60_000);
  if (isLoading) return <ScreenLoader />;
  return (
    <div data-screen-label="Messages" className="flex animate-in flex-col gap-3">
      <button
        type="button"
        onClick={() => openSheet('newMessage')}
        className="tap flex h-[52px] items-center gap-2.5 self-start rounded-[26px] border-0 bg-card px-5 text-[15px] font-bold text-ink shadow-pill active:scale-[.97]"
      >
        <PencilSimple size={20} /> Nouveau message
      </button>
      {data?.length === 0 ? (
        <EmptyCard icon={<ChatCircleDots size={30} weight="fill" />} title="Aucune conversation" text="Écris à un ami, réponds à une story ou invite quelqu’un dans un salon Make It Friends.">
          <PrimaryBtn onClick={() => openSheet('newMessage')}>Écrire à un ami</PrimaryBtn>
        </EmptyCard>
      ) : (
        <div className="card flex flex-col gap-0.5 p-2">
          {data?.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => nav(`/messages/${c.id}`)}
              className="tap flex items-center gap-3 rounded-3xl border-0 bg-transparent p-2.5 text-left text-ink transition-colors hover:bg-soft"
            >
              <Avatar user={c.user} size={48} />
              <span className="min-w-0 flex-1">
                <span className={cx('block text-[15px]', c.unread ? 'font-extrabold' : 'font-bold')}>{c.user.displayName}</span>
                <span className={cx('block truncate text-sm', c.unread ? 'font-semibold text-ink' : 'text-mute')}>
                  {c.last ? `${c.last.mine ? 'Toi : ' : ''}${c.last.text}` : 'Nouvelle conversation'}
                </span>
              </span>
              <span className="flex flex-none flex-col items-end gap-1.5">
                <span className="text-xs text-mute">{c.last ? shortTime(c.last.at, now) : ''}</span>
                <span className="h-2.5 w-2.5 rounded-full bg-brand" style={{ opacity: c.unread ? 1 : 0 }} />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Chat() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { data: me } = useMe();
  const { data: conv } = useConversation(id);
  const { data: msgs, isLoading } = useMessages(id);
  const [draft, setDraft] = useState('');
  const bottom = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
    // Les messages reçus pendant que la conversation est ouverte sont lus.
    const last = msgs?.[msgs.length - 1];
    if (last && me && last.senderId !== me.id) {
      api(`/api/conversations/${id}/read`, { method: 'POST' })
        .then(() => qc.invalidateQueries({ queryKey: ['conversations'] }))
        .catch(() => {});
    }
  }, [msgs?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    try {
      const m = await api<Message>(`/api/conversations/${id}/messages`, { body: { text } });
      qc.setQueryData<Message[]>(['messages', id], (old) => (old && !old.some((x) => x.id === m.id) ? [...old, m] : old));
      qc.invalidateQueries({ queryKey: ['conversations'] });
    } catch (e) {
      setDraft(text);
      toast(errMsg(e), 'error');
    }
  };

  if (isLoading || !me) return <ScreenLoader />;

  return (
    <div className="card flex min-h-[62vh] animate-in flex-col gap-3 p-3" style={{ animationDuration: '.4s' }}>
      <div className="flex items-center gap-2.5">
        {conv && (
          <button type="button" onClick={() => nav(`/u/${conv.user.username}`)} className="tap flex items-center gap-2.5 border-0 bg-transparent p-0 text-ink">
            <Avatar user={conv.user} size={40} />
            <span className="text-[17px] font-extrabold">{conv.user.displayName}</span>
          </button>
        )}
      </div>
      <div className="flex flex-1 flex-col justify-end gap-1.5">
        {msgs?.length === 0 && <div className="py-8 text-center text-sm text-mute">Dis bonjour 👋</div>}
        {msgs?.map((m) => {
          const mine = m.senderId === me.id;
          return (
            <div
              key={m.id}
              className={cx(
                'max-w-[80%] animate-in rounded-[22px] px-3.5 py-2.5 text-base leading-[1.4] break-words',
                mine ? 'self-end bg-brand text-white' : 'self-start bg-soft text-ink',
              )}
              style={{ animationDuration: '.35s' }}
            >
              {m.meta?.type === 'story_reply' && <span className={cx('mb-0.5 block text-xs font-semibold', mine ? 'text-white/75' : 'text-mute')}>Réponse à une story</span>}
              <span>{m.text}</span>
              {m.meta?.type === 'game_invite' && !mine && (
                <button
                  type="button"
                  onClick={() => nav(`/jeu?code=${(m.meta as { code: string }).code}`)}
                  className="tap mt-2 block h-11 rounded-[22px] border-0 bg-brand px-4 text-sm font-bold text-white"
                >
                  Rejoindre le salon
                </button>
              )}
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input className="field flex-1" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000} placeholder="Écris un message…" />
        <button type="submit" aria-label="Envoyer" className="tap grid h-12 w-12 flex-none place-items-center rounded-full border-0 bg-ink text-inv active:scale-90">
          <PaperPlaneRight size={20} weight="fill" />
        </button>
      </form>
    </div>
  );
}
