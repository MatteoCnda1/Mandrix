import { splitRichText } from '@mandrix/shared';
import { Fragment, useMemo, type RefObject } from 'react';
import { Link } from 'react-router';
import { useFriends } from '../lib/data';
import { Avatar, cx } from './ui';

/** Texte avec @mentions et #hashtags cliquables (aucun HTML injecté : uniquement des nœuds React). */
export function RichText({ text, linkClass }: { text: string; linkClass?: string }) {
  const parts = useMemo(() => splitRichText(text), [text]);
  return (
    <>
      {parts.map((p, i) =>
        p.type === 'text' ? (
          <Fragment key={i}>{p.value}</Fragment>
        ) : p.type === 'url' ? (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={(e) => e.stopPropagation()}
            className={cx('font-semibold break-all underline underline-offset-2', linkClass ?? 'text-acc')}
          >
            {p.value.replace(/^https?:\/\/(www\.)?/, '')}
          </a>
        ) : (
          <Link
            key={i}
            to={p.type === 'mention' ? `/u/${p.username}` : `/recherche?q=${encodeURIComponent(`#${p.tag}`)}`}
            onClick={(e) => e.stopPropagation()}
            className={cx('font-bold no-underline hover:underline', linkClass ?? 'text-acc')}
          >
            {p.value}
          </Link>
        ),
      )}
    </>
  );
}

type Field = HTMLInputElement | HTMLTextAreaElement;

/**
 * Suggestions d'amis quand on tape « @ » dans un champ : une rangée de puces au-dessus du clavier.
 * `value`/`onChange` sont ceux du champ ; `inputRef` sert à lire et replacer le curseur.
 */
export function MentionSuggestions({ value, onChange, inputRef, className }: { value: string; onChange: (v: string) => void; inputRef: RefObject<Field | null>; className?: string }) {
  const { data } = useFriends();
  // Au rendu qui suit la saisie, le curseur du champ est déjà à jour.
  const before = value.slice(0, inputRef.current?.selectionStart ?? value.length);
  const m = before.match(/(^|\s)@([a-z0-9._]{0,20})$/i);
  if (!m) return null;
  const q = m[2].toLowerCase();
  const friends = (data?.friends ?? [])
    .filter((f) => f.username.startsWith(q) || f.displayName.toLowerCase().split(' ').some((w) => w.startsWith(q)))
    .slice(0, 6);
  if (friends.length === 0) return null;

  const pick = (username: string) => {
    const at = before.length - m[2].length - 1;
    const after = value.slice(before.length);
    const next = `${value.slice(0, at)}@${username} ${after.replace(/^\s+/, '')}`;
    onChange(next);
    const c = at + username.length + 2;
    requestAnimationFrame(() => {
      const el = inputRef.current;
      el?.focus();
      el?.setSelectionRange(c, c);
    });
  };

  return (
    <div className={cx('no-scrollbar flex gap-1.5 overflow-x-auto', className)} role="listbox" aria-label="Mentionner un ami">
      {friends.map((f) => (
        <button
          key={f.id}
          type="button"
          role="option"
          aria-selected={false}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => pick(f.username)}
          className="tap flex h-11 flex-none items-center gap-1.5 rounded-full border-0 bg-soft py-1 pr-3 pl-1.5 text-sm font-semibold text-ink"
        >
          <Avatar user={f} size={30} />
          <span>{f.displayName.split(' ')[0]}</span>
          <span className="text-mute">@{f.username}</span>
        </button>
      ))}
    </div>
  );
}
