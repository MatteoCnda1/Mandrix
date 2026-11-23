import type { Comment } from '@mandrix/shared';
import { ArrowBendDownRight, Flag, Heart, PaperPlaneRight, X } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { openReport } from '../components/Report';
import { MentionSuggestions, RichText } from '../components/RichText';
import { Avatar, Sheet, confirmAction, cx } from '../components/ui';
import { api, errMsg } from '../lib/api';
import { patchPost, qc, useComments, useMe } from '../lib/data';
import { fmtCount, timeAgo } from '../lib/format';
import { toast, useUI } from '../lib/store';

export function CommentsSheet({ postId }: { postId: string }) {
  const { data: me } = useMe();
  const { data, isLoading } = useComments(postId);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  /** Commentaire auquel on répond (#74). */
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const close = () => useUI.setState({ commentsFor: null });

  const setList = (fn: (l: Comment[]) => Comment[]) => qc.setQueryData<Comment[]>(['comments', postId], (old) => fn(old ?? []));

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const c = await api<Comment>(`/api/posts/${postId}/comments`, { body: { text, parentId: replyTo?.id } });
      setList((l) => [...l, c]);
      patchPost(postId, (p) => ({ ...p, comments: p.comments + 1 }));
      setDraft('');
      setReplyTo(null);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setSending(false);
    }
  };

  const like = async (c: Comment) => {
    const on = !c.liked;
    const apply = (liked: boolean) => setList((l) => l.map((x) => (x.id === c.id ? { ...x, liked, likes: x.likes + (liked ? 1 : -1) } : x)));
    apply(on);
    try {
      await api(`/api/comments/${c.id}/like`, { method: on ? 'PUT' : 'DELETE' });
    } catch (e) {
      apply(!on);
      toast(errMsg(e), 'error');
    }
  };

  const remove = async (c: Comment) => {
    if (!(await confirmAction({ title: 'Supprimer ce commentaire ?', confirmLabel: 'Supprimer', destructive: true }))) return;
    try {
      await api(`/api/comments/${c.id}`, { method: 'DELETE' });
      // Ses réponses partent avec lui.
      const gone = (data ?? []).filter((x) => x.id === c.id || x.parentId === c.id).length || 1;
      setList((l) => l.filter((x) => x.id !== c.id && x.parentId !== c.id));
      patchPost(postId, (p) => ({ ...p, comments: Math.max(0, p.comments - gone) }));
      if (replyTo && (replyTo.id === c.id || replyTo.parentId === c.id)) setReplyTo(null);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const startReply = (c: Comment) => {
    setReplyTo(c);
    requestAnimationFrame(() => input.current?.focus());
  };

  // Un seul niveau : les réponses s'affichent sous leur commentaire, dans l'ordre d'arrivée.
  const ids = new Set((data ?? []).map((c) => c.id));
  const tops = (data ?? []).filter((c) => !c.parentId || !ids.has(c.parentId));
  const repliesOf = (id: string) => (data ?? []).filter((c) => c.parentId === id);

  const row = (c: Comment, reply = false) => (
    <div key={c.id} className={cx('flex animate-in items-center gap-2.5', reply && 'pl-12')} style={{ animationDuration: '.35s' }}>
      <Avatar user={c.author} size={reply ? 30 : 38} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-bold">{c.author.displayName}</span>
          <span className="text-xs text-mute">{timeAgo(c.createdAt)}</span>
          {me && (
            <button type="button" className="tap border-0 bg-transparent p-0 text-xs font-semibold text-mute hover:text-ink" onClick={() => startReply(c)}>
              Répondre
            </button>
          )}
          {me && (c.author.id === me.id || me.isAdmin) && (
            <button type="button" className="tap border-0 bg-transparent p-0 text-xs font-semibold text-mute hover:text-heart" onClick={() => remove(c)}>
              Supprimer
            </button>
          )}
          {me && c.author.id !== me.id && (
            <button
              type="button"
              aria-label={`Signaler le commentaire de ${c.author.displayName}`}
              className="tap grid h-7 w-7 place-items-center border-0 bg-transparent p-0 text-mute hover:text-heart"
              onClick={() => openReport({ targetType: 'comment', targetId: c.id, authorName: c.author.displayName.split(' ')[0] })}
            >
              <Flag size={14} />
            </button>
          )}
        </div>
        <div className="text-base leading-[1.4] break-words">
          <RichText text={c.text} />
        </div>
      </div>
      <button type="button" aria-label="Aimer le commentaire" onClick={() => like(c)} className="tap flex h-11 min-w-11 flex-none flex-col items-center justify-center border-0 bg-transparent">
        <Heart size={20} weight={c.liked ? 'fill' : 'regular'} className={cx(c.liked ? 'animate-pop text-heart' : 'text-mute')} />
        {c.likes > 0 && <span className="text-[0.6875rem] font-bold text-mute">{c.likes}</span>}
      </button>
    </div>
  );

  return (
    <Sheet title={`Commentaires · ${fmtCount(data?.length ?? 0)}`} onClose={close}>
      <div className="flex flex-col gap-1.5">
        {isLoading && <div className="py-6 text-center text-sm text-mute">Chargement…</div>}
        {data?.length === 0 && <div className="py-6 text-center text-sm text-mute">Sois le premier à commenter.</div>}
        {tops.map((c) => [row(c), ...repliesOf(c.id).map((r) => row(r, true))])}
      </div>
      <MentionSuggestions value={draft} onChange={setDraft} inputRef={input} className="flex-none" />
      {replyTo && (
        <div className="flex flex-none items-center gap-2 rounded-2xl bg-soft px-3 py-2 text-[0.8125rem]">
          <ArrowBendDownRight size={16} className="flex-none text-mute" />
          <span className="min-w-0 flex-1 truncate">
            Réponse à <b>{replyTo.author.id === me?.id ? 'toi' : replyTo.author.displayName.split(' ')[0]}</b> · <span className="text-mute">{replyTo.text}</span>
          </span>
          <button type="button" aria-label="Annuler la réponse" onClick={() => setReplyTo(null)} className="tap grid h-7 w-7 flex-none place-items-center rounded-full border-0 bg-transparent text-mute">
            <X size={16} />
          </button>
        </div>
      )}
      <form
        className="flex flex-none gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input ref={input} className="field flex-1" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={200} placeholder={replyTo ? 'Ta réponse…' : 'Ajoute un commentaire, @mentionne un ami…'} />
        <button type="submit" aria-label="Envoyer" className="tap grid h-12 w-12 flex-none place-items-center rounded-full border-0 bg-ink text-inv active:scale-90">
          <PaperPlaneRight size={20} weight="fill" />
        </button>
      </form>
    </Sheet>
  );
}
