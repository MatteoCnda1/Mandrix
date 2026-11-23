import { GUESS, type GuessItem, type GuessState } from '@mandrix/shared';
import { CheckCircle, Package, Question, XCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { api, errMsg } from '../lib/api';
import { qc, useGuess } from '../lib/data';
import { toast } from '../lib/store';
import { Avatar, MediaView, PrimaryBtn, ScreenLoader, cx } from './ui';

const firstName = (name: string) => name.split(' ')[0];

/** Classement de la semaine (joueurs qui ont fini le quiz). */
export function GuessRanking({ state, meId }: { state: GuessState; meId: string }) {
  if (!state.ranking.length) return <p className="m-0 text-sm text-mute">Personne n’a encore fini le quiz cette semaine.</p>;
  return (
    <ol className="m-0 flex list-none flex-col gap-1 p-0">
      {state.ranking.map((r, i) => (
        <li key={r.user.id} className={cx('flex items-center gap-2.5 rounded-[20px] px-3 py-2 text-sm font-semibold', r.user.id === meId ? 'bg-tint' : 'bg-soft')}>
          <span className="w-5 text-mute">{i + 1}</span>
          <Avatar user={r.user} size={30} />
          <span className="min-w-0 flex-1 truncate">{r.user.id === meId ? 'Toi' : r.user.displayName}</span>
          <span className="text-mute">
            {r.hits} bonne{r.hits > 1 ? 's' : ''} réponse{r.hits > 1 ? 's' : ''}
          </span>
          <span className="w-14 text-right font-extrabold">{r.score} pts</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * « Qui a pris ça ? » (#88) : avant le Déballage, on devine l'auteur de quelques photos de la semaine.
 * Le serveur garde les photos cachées tant que le quiz n'est ni fini ni passé.
 */
export function GuessQuiz({ meId }: { meId: string }) {
  const { data, isLoading } = useGuess();
  const [busy, setBusy] = useState(false);
  /** Photo dont on affiche le résultat (avant de passer à la suivante). */
  const [shown, setShown] = useState<string | null>(null);
  if (isLoading || !data) return <ScreenLoader />;

  const set = (s: GuessState) => qc.setQueryData(['guess'], s);
  const openUnpack = () => {
    qc.invalidateQueries({ queryKey: ['unpack'] });
    qc.invalidateQueries({ queryKey: ['season'] });
  };

  const answer = async (item: GuessItem, userId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      set(await api<GuessState>('/api/pellicule/guess', { body: { shotId: item.shotId, userId } }));
      setShown(item.shotId);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    setBusy(true);
    try {
      set(await api<GuessState>('/api/pellicule/guess/skip', { method: 'POST' }));
      openUnpack();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const answered = data.items.filter((i) => i.myGuess).length;
  const hits = data.items.filter((i) => i.myGuess && i.answer && i.myGuess === i.answer.id).length;
  const current = data.items.find((i) => i.shotId === shown) ?? data.items.find((i) => !i.myGuess);

  // Fini : score, classement, et le Déballage s'ouvre.
  if (!current) {
    return (
      <div className="card flex animate-in flex-col gap-3.5 p-[18px]">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 flex-none place-items-center rounded-full bg-brand text-white">
            <CheckCircle size={26} weight="fill" />
          </span>
          <div className="min-w-0">
            <div className="text-xl font-extrabold tracking-[-.02em]">
              {hits}/{data.items.length} · {data.score} points
            </div>
            <div className="text-sm text-mute">{hits === data.items.length ? 'Sans faute : tu connais bien la bande !' : 'Les points comptent pour la saison.'}</div>
          </div>
        </div>
        <div className="text-[0.9375rem] font-extrabold">Classement de la semaine</div>
        <GuessRanking state={data} meId={meId} />
        <PrimaryBtn tone="brand" onClick={openUnpack}>
          <Package size={18} weight="fill" /> Déballer la semaine
        </PrimaryBtn>
      </div>
    );
  }

  const done = !!current.myGuess;
  const right = done && current.answer?.id === current.myGuess;
  const index = data.items.indexOf(current);
  return (
    <div className="card flex animate-in flex-col gap-3.5 p-[18px]">
      <div className="flex items-start gap-3">
        <span className="grid h-12 w-12 flex-none place-items-center rounded-full bg-tint">
          <Question size={24} weight="bold" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xl font-extrabold tracking-[-.02em]">Qui a pris ça ?</div>
          <div className="text-sm text-mute">
            Devine avant de déballer · {GUESS.pointsPerHit} points par bonne réponse
          </div>
        </div>
        <span className="flex-none rounded-[14px] bg-soft px-3 py-1.5 text-xs font-bold tabular-nums">
          {index + 1}/{data.items.length}
        </span>
      </div>
      <div className="ph mx-auto aspect-[3/4] w-full max-w-[360px] overflow-hidden rounded-[26px]">
        <MediaView media={current.media} sizes="360px" />
      </div>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Qui a pris cette photo ?">
        {current.options.map((o) => {
          const isAnswer = done && current.answer?.id === o.id;
          const isMine = done && current.myGuess === o.id;
          return (
            <button
              key={o.id}
              type="button"
              disabled={done || busy}
              onClick={() => answer(current, o.id)}
              aria-pressed={isMine}
              className={cx(
                'tap flex items-center gap-2.5 rounded-[22px] border-2 border-solid p-2 text-left text-ink transition-colors',
                isAnswer ? 'border-[#30c463] bg-[#30c463]/15' : isMine ? 'border-heart bg-heart/10' : 'border-transparent bg-soft',
                !done && 'active:scale-[.97]',
              )}
            >
              <Avatar user={o} size={40} />
              <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-bold">{firstName(o.displayName)}</span>
              {isAnswer && <CheckCircle size={22} weight="fill" className="flex-none text-[#30c463]" />}
              {isMine && !isAnswer && <XCircle size={22} weight="fill" className="flex-none text-heart" />}
            </button>
          );
        })}
      </div>
      {done ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          <div className={cx('text-center text-[0.9375rem] font-extrabold', right ? 'text-[#1f9d4b]' : 'text-heart')}>
            {right ? `Bien vu ! +${GUESS.pointsPerHit} points` : `Raté : c’était ${current.answer ? firstName(current.answer.displayName) : '…'}`}
          </div>
          <PrimaryBtn onClick={() => setShown(null)}>{answered < data.items.length ? 'Photo suivante' : 'Voir mon score'}</PrimaryBtn>
        </div>
      ) : (
        <button type="button" disabled={busy} onClick={skip} className="tap self-center border-0 bg-transparent text-sm font-bold text-mute underline underline-offset-4">
          Passer et déballer tout de suite
        </button>
      )}
    </div>
  );
}

/** Après le quiz : score de la semaine et classement, repliés. */
export function GuessSummary({ meId }: { meId: string }) {
  const { data } = useGuess();
  const [open, setOpen] = useState(false);
  if (!data || data.status === 'none' || data.status === 'todo') return null;
  const hits = data.items.filter((i) => i.myGuess && i.answer && i.myGuess === i.answer.id).length;
  return (
    <div className="card flex flex-col gap-3 p-[18px]">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="tap flex items-center gap-3 border-0 bg-transparent p-0 text-left text-ink">
        <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-tint">
          <Question size={22} weight="bold" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[1.0625rem] font-extrabold">Qui a pris ça ?</span>
          <span className="block text-sm text-mute">
            {data.status === 'skipped' && hits === 0 ? 'Passé cette semaine' : `${hits}/${data.items.length} · ${data.score} points`} · {open ? 'masquer' : 'voir'} le classement
          </span>
        </span>
      </button>
      {open && <GuessRanking state={data} meId={meId} />}
    </div>
  );
}
