import type { Comment } from '@mandrix/shared';
import { Heart, PaperPlaneRight } from '@phosphor-icons/react';
import { useState } from 'react';
import { Avatar, Sheet, cx } from '../components/ui';
import { api, errMsg } from '../lib/api';
import { patchPost, qc, useComments, useMe } from '../lib/data';
import { fmtCount, timeAgo } from '../lib/format';
import { toast, useUI } from '../lib/store';

export function CommentsSheet({ postId }: { postId: string }) {
  const { data: me } = useMe();
  const { data, isLoading } = useComments(postId);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const close = () => useUI.setState({ commentsFor: null });

  const setList = (fn: (l: Comment[]) => Comment[]) => qc.setQueryData<Comment[]>(['comments', postId], (old) => fn(old ?? []));

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const c = await api<Comment>(`/api/posts/${postId}/comments`, { body: { text } });
      setList((l) => [...l, c]);
      patchPost(postId, (p) => ({ ...p, comments: p.comments + 1 }));
      setDraft('');
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
    if (!confirm('Supprimer ce commentaire ?')) return;
    try {
      await api(`/api/comments/${c.id}`, { method: 'DELETE' });
      setList((l) => l.filter((x) => x.id !== c.id));
      patchPost(postId, (p) => ({ ...p, comments: Math.max(0, p.comments - 1) }));
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  return (
    <Sheet title={`Commentaires · ${fmtCount(data?.length ?? 0)}`} onClose={close}>
      <div className="flex flex-col gap-1.5">
        {isLoading && <div className="py-6 text-center text-sm text-mute">Chargement…</div>}
        {data?.length === 0 && <div className="py-6 text-center text-sm text-mute">Sois le premier à commenter.</div>}
        {data?.map((c) => (
          <div key={c.id} className="flex animate-in items-center gap-2.5" style={{ animationDuration: '.35s' }}>
            <Avatar user={c.author} size={38} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-bold">{c.author.displayName}</span>
                <span className="text-xs text-mute">{timeAgo(c.createdAt)}</span>
                {me && (c.author.id === me.id || me.isAdmin) && (
                  <button type="button" className="tap border-0 bg-transparent p-0 text-xs font-semibold text-mute hover:text-heart" onClick={() => remove(c)}>
                    Supprimer
                  </button>
                )}
              </div>
              <div className="text-[15px] leading-[1.4] break-words">{c.text}</div>
            </div>
            <button type="button" aria-label="Aimer le commentaire" onClick={() => like(c)} className="tap flex h-11 min-w-11 flex-none flex-col items-center justify-center border-0 bg-transparent">
              <Heart size={20} weight={c.liked ? 'fill' : 'regular'} className={cx(c.liked ? 'animate-pop text-heart' : 'text-mute')} />
              {c.likes > 0 && <span className="text-[11px] font-bold text-mute">{c.likes}</span>}
            </button>
          </div>
        ))}
      </div>
      <form
        className="flex flex-none gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input className="field flex-1" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={200} placeholder="Ajoute un commentaire…" />
        <button type="submit" aria-label="Envoyer" className="tap grid h-12 w-12 flex-none place-items-center rounded-full border-0 bg-ink text-inv active:scale-90">
          <PaperPlaneRight size={20} weight="fill" />
        </button>
      </form>
    </Sheet>
  );
}
