import { DAILY, type DailyMeme, type DailyState, type SeasonState } from '@mandrix/shared';
import { CheckCircle, Crown, HourglassMedium, PencilSimple, Trash } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, errMsg } from '../lib/api';
import { qc } from '../lib/data';
import { countdown, fmtCount } from '../lib/format';
import { useNow } from '../lib/hooks';
import { toast } from '../lib/store';
import { Avatar, cx, MediaView, Podium, PrimaryBtn, WholeMedia } from './ui';

export const useDaily = () => useQuery({ queryKey: ['daily'], queryFn: () => api<DailyState>('/api/daily'), refetchInterval: 60_000 });
export const useSeason = () => useQuery({ queryKey: ['season'], queryFn: () => api<SeasonState>('/api/season') });

const setDaily = (today: DailyMeme) => qc.setQueryData<DailyState>(['daily'], (old) => (old ? { ...old, today } : old));

function PhaseChip({ meme }: { meme: DailyMeme }) {
  const now = useNow(1000);
  const target = meme.phase === 'caption' ? meme.voteAt : meme.closeAt;
  const cd = countdown(target, now);
  const hours = Number(cd.d) * 24 + Number(cd.h);
  const left = cd.done ? 'bientôt' : `${hours > 0 ? `${hours} h ` : ''}${cd.m} min`;
  return (
    <span className="flex h-9 items-center gap-1.5 rounded-full bg-tint px-3 text-[0.8125rem] font-bold text-acc tabular-nums">
      <HourglassMedium size={16} weight="fill" />
      {meme.phase === 'caption' ? `Légendes · votes dans ${left}` : `Votes · fin dans ${left}`}
    </span>
  );
}

function CaptionPhase({ meme }: { meme: DailyMeme }) {
  const [text, setText] = useState(meme.myCaption ?? '');
  const [editing, setEditing] = useState(!meme.myCaption);
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(meme.myCaption ?? ''), [meme.myCaption]);

  const save = async () => {
    setBusy(true);
    try {
      setDaily(await api<DailyMeme>('/api/daily/caption', { method: 'PUT', body: { text } }));
      setEditing(false);
      toast('Légende enregistrée, rendez-vous à 18 h pour les votes');
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    try {
      setDaily(await api<DailyMeme>('/api/daily/caption', { method: 'DELETE' }));
      setText('');
      setEditing(true);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  if (!editing && meme.myCaption) {
    return (
      <div className="flex flex-col gap-2">
        <div className="rounded-[22px] bg-soft p-4 text-center text-[1.0625rem] leading-tight font-extrabold text-balance">{meme.myCaption}</div>
        <div className="flex gap-2">
          <PrimaryBtn tone="soft" className="h-11 flex-1 text-sm" onClick={() => setEditing(true)}>
            <PencilSimple size={16} /> Modifier
          </PrimaryBtn>
          <PrimaryBtn tone="soft" className="h-11 text-sm text-heart" onClick={remove}>
            <Trash size={16} />
            <span className="sr-only">Retirer ma légende</span>
          </PrimaryBtn>
        </div>
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) void save();
      }}
    >
      <textarea
        className="field min-h-[88px] resize-none py-3 text-[1.0625rem] font-bold"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={120}
        placeholder="Ta légende la plus drôle…"
        aria-label="Ta légende"
      />
      <PrimaryBtn type="submit" tone="brand" disabled={busy || !text.trim()}>
        {meme.myCaption ? 'Enregistrer' : 'Proposer ma légende'}
      </PrimaryBtn>
      <p className="m-0 px-1 text-[0.8125rem] text-mute">Une légende par personne, modifiable jusqu’à {DAILY.voteHour} h. Les votes sont anonymes.</p>
    </form>
  );
}

function VotePhase({ meme }: { meme: DailyMeme }) {
  const vote = async (captionId: string) => {
    try {
      setDaily(await api<DailyMeme>('/api/daily/vote', { body: { captionId } }));
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  if (meme.captions.length < 2) return <p className="m-0 text-[0.9375rem] text-mute">Pas assez de légendes aujourd’hui pour voter. Reviens demain !</p>;
  return (
    <div className="flex flex-col gap-2" role="radiogroup" aria-label="Choisis ta légende préférée">
      {meme.captions.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={meme.myVote === c.id}
          disabled={c.mine}
          onClick={() => vote(c.id)}
          className={cx(
            'tap flex min-h-14 items-center gap-3 rounded-[22px] border-0 px-4 py-3 text-left text-[0.9375rem] font-bold transition-colors disabled:cursor-default',
            meme.myVote === c.id ? 'bg-brand text-white' : 'bg-soft text-ink',
          )}
        >
          <span className="flex-1 text-balance">{c.text}</span>
          {c.mine && <span className="flex-none rounded-full bg-card px-2.5 py-1 text-xs text-mute">Ta légende</span>}
          {meme.myVote === c.id && <CheckCircle size={20} weight="fill" className="flex-none" />}
        </button>
      ))}
      <p className="m-0 px-1 text-[0.8125rem] text-mute">Tu peux changer d’avis jusqu’à minuit. Résultats demain matin.</p>
    </div>
  );
}

function Results({ meme }: { meme: DailyMeme }) {
  if (meme.captions.length === 0) return <p className="m-0 text-[0.9375rem] text-mute">Personne n’a joué ce jour-là.</p>;
  return (
    <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
      {meme.captions.map((c, i) => (
        <li key={c.id} className={cx('flex items-center gap-3 rounded-[20px] p-2.5', c.winner ? 'bg-tint' : 'bg-soft')}>
          <span className="w-6 flex-none text-center text-sm font-extrabold text-mute">{c.winner ? <Crown size={20} weight="fill" className="text-ember" /> : i + 1}</span>
          {c.user && <Avatar user={c.user} size={32} />}
          <span className="min-w-0 flex-1">
            <span className="block text-[0.9375rem] leading-tight font-bold">{c.text}</span>
            <span className="block text-xs text-mute">{c.mine ? 'Toi' : c.user?.displayName}</span>
          </span>
          <span className="flex-none text-sm font-extrabold tabular-nums">
            {c.votes} vote{(c.votes ?? 0) > 1 ? 's' : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Mème du jour : la légende d'aujourd'hui (ou le vote) et les résultats d'hier. */
export function DailyMemeView({ emptyPool }: { emptyPool?: React.ReactNode }) {
  const { data, isLoading } = useDaily();
  if (isLoading) return <div className="skel h-80 rounded-[32px]" />;
  const today = data?.today;
  const yesterday = data?.yesterday;
  return (
    <div className="flex flex-col gap-3.5">
      {today ? (
        <section className="card flex flex-col gap-3.5 p-4" aria-label="Mème du jour">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-[1.375rem] font-extrabold tracking-[-.02em]">Mème du jour</h2>
            <span className="ml-auto">
              <PhaseChip meme={today} />
            </span>
          </div>
          <WholeMedia media={today.media} className="rounded-[24px]" />
          <div className="text-[0.8125rem] font-semibold text-mute">{today.participants ? `${fmtCount(today.participants)} légende${today.participants > 1 ? 's' : ''} proposée${today.participants > 1 ? 's' : ''}` : 'Sois le premier à proposer une légende'}</div>
          {today.phase === 'caption' ? <CaptionPhase meme={today} /> : <VotePhase meme={today} />}
        </section>
      ) : (
        <section className="card flex flex-col gap-2 p-5">
          <h2 className="m-0 text-[1.375rem] font-extrabold tracking-[-.02em]">Mème du jour</h2>
          <p className="m-0 text-[0.9375rem] text-mute">Une image du pool public est tirée chaque matin à {DAILY.drawHour} h. Chacun propose sa légende quand il veut, les votes ouvrent à {DAILY.voteHour} h.</p>
          {emptyPool}
        </section>
      )}
      {yesterday && (
        <section className="card flex flex-col gap-3 p-4" aria-label="Résultats d’hier">
          <h3 className="m-0 text-[1.0625rem] font-extrabold">Résultats d’hier</h3>
          <div className="flex gap-3">
            <div className="ph h-24 w-24 flex-none overflow-hidden rounded-[18px]">
              <MediaView media={yesterday.media} sizes="96px" />
            </div>
            <div className="min-w-0 flex-1">
              <Results meme={yesterday} />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

/** Classement de la saison (mois en cours) : parties + mèmes du jour. */
export function SeasonBoard() {
  const nav = useNavigate();
  const { data } = useSeason();
  if (!data) return null;
  const [first, second, third] = data.ranking;
  const rest = data.ranking.slice(3, 10);
  return (
    <section className="card flex flex-col gap-4 p-5" aria-label={data.label}>
      <div>
        <div className="text-[1.375rem] font-extrabold tracking-[-.02em] first-letter:uppercase">{data.label}</div>
        <div className="text-[0.8125rem] text-mute">Points des parties de Make It Friends, des mèmes du jour et de « Qui a pris ça ? ». Remise à zéro chaque mois.</div>
      </div>
      {data.ranking.length === 0 ? (
        <p className="m-0 text-[0.9375rem] text-mute">Personne n’a encore marqué de points ce mois-ci.</p>
      ) : (
        <Podium
          height={230}
          heights={['120px', '90px', '66px']}
          entries={[first, second, third]
            .filter((e) => !!e)
            .map((e) => ({
              key: e.user.id,
              top: (
                <button type="button" className="tap border-0 bg-transparent p-0" onClick={() => nav(`/u/${e.user.username}`)} aria-label={e.user.displayName}>
                  <Avatar user={e.user} size={46} />
                </button>
              ),
              label: <span className="truncate text-xs font-bold">{e.user.displayName.split(' ')[0]}</span>,
              sub: <span className="text-[0.8125rem] font-extrabold tabular-nums">{fmtCount(e.points)} pts</span>,
            }))}
        />
      )}
      {rest.length > 0 && (
        <ol className="m-0 flex list-none flex-col gap-1 p-0" start={4}>
          {rest.map((e, i) => (
            <li key={e.user.id} className="flex items-center gap-3 rounded-[18px] px-2 py-1.5">
              <span className="w-6 text-center text-sm font-extrabold text-mute">{i + 4}</span>
              <Avatar user={e.user} size={30} />
              <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-bold">{e.user.displayName}</span>
              <span className="text-sm font-extrabold tabular-nums">{fmtCount(e.points)} pts</span>
            </li>
          ))}
        </ol>
      )}
      {data.champions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[0.8125rem] font-bold tracking-wide text-mute uppercase">Champions des saisons passées</div>
          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
            {data.champions.map((c) => (
              <div key={c.month} className="flex flex-none items-center gap-2 rounded-full bg-soft py-1 pr-3 pl-1">
                <Avatar user={c.user} size={30} />
                <span className="text-[0.8125rem] font-bold">
                  <Crown size={14} weight="fill" className="mr-1 inline text-ember" />
                  {c.label.replace(/^Saison de /, '')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
