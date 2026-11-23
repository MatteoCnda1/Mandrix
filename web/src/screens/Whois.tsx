import { WHOIS, type WhoisQuestion, type WhoisRoom } from '@mandrix/shared';
import { ChatCircleText, CheckCircle, CircleNotch, Copy, Crown, HourglassMedium, Play, Plus, SignOut, Timer, Trash, UsersThree } from '@phosphor-icons/react';
import { useState } from 'react';
import { Avatar, PrimaryBtn, Seg, confirmAction, cx } from '../components/ui';
import { api, errMsg } from '../lib/api';
import { qc, useWhoisQuestions } from '../lib/data';
import { useNow } from '../lib/hooks';
import { gameEmit, useGame, useWhois } from '../lib/socket';
import { openInvite, toast } from '../lib/store';

// « Qui de nous… ? » (#89) : une question, chacun désigne un joueur, révélation anonyme.

const first = (name: string) => name.split(' ')[0];

function Hero({ code }: { code?: string }) {
  return (
    <div className="flex flex-col gap-3.5 rounded-[32px] bg-gradient-to-br from-[#7b2ff7] to-[#e5484d] p-6 text-white shadow-hero">
      <div className="text-[clamp(34px,8vw,52px)] leading-none font-extrabold tracking-[-.05em]">Qui de nous… ?</div>
      <p className="m-0 max-w-[420px] text-base leading-[1.45] text-white/85">Une question, chacun désigne quelqu’un de la bande. Les votes restent anonymes, le résultat non.</p>
      {code && <span className="flex h-10 w-fit items-center rounded-[20px] bg-white/15 px-3.5 font-mono text-sm font-semibold">{code}</span>}
    </div>
  );
}

async function enter(event: 'whois:create' | 'whois:join', code?: string) {
  const room = await (code ? gameEmit<WhoisRoom>(event, code) : gameEmit<WhoisRoom>(event));
  if (room) useWhois.setState({ room });
  return room;
}

/** Questions écrites par la bande : les miennes (supprimables) et celles de mes amis. */
function QuestionBank() {
  const { data } = useWhoisQuestions();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const add = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const q = await api<WhoisQuestion>('/api/whois/questions', { body: { text: text.trim() } });
      qc.setQueryData<WhoisQuestion[]>(['whois-questions'], (old) => [q, ...(old ?? [])]);
      setText('');
      toast('Question ajoutée');
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (q: WhoisQuestion) => {
    if (!(await confirmAction({ title: 'Supprimer cette question ?', message: q.text, confirmLabel: 'Supprimer', destructive: true }))) return;
    try {
      await api(`/api/whois/questions/${q.id}`, { method: 'DELETE' });
      qc.setQueryData<WhoisQuestion[]>(['whois-questions'], (old) => old?.filter((x) => x.id !== q.id));
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  const list = data ?? [];
  const shown = all ? list : list.slice(0, 5);
  return (
    <div className="card flex flex-col gap-3 p-[18px]">
      <div>
        <div className="text-[1.0625rem] font-extrabold">Questions de la bande</div>
        <div className="text-sm text-mute">
          Elles se mélangent aux questions de base dans les parties avec tes amis{list.length ? ` · ${list.length} pour l’instant` : ''}.
        </div>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          className="field min-w-0 flex-1"
          value={text}
          maxLength={WHOIS.questionMax}
          onChange={(e) => setText(e.target.value)}
          placeholder="Qui de nous… finirait chanteur d’opéra ?"
          aria-label="Nouvelle question"
        />
        <button type="submit" disabled={busy || text.trim().length < 8} aria-label="Ajouter la question" className="tap grid h-12 w-12 flex-none place-items-center rounded-full border-0 bg-ink text-inv disabled:bg-line disabled:text-mute">
          <Plus size={20} weight="bold" />
        </button>
      </form>
      {shown.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {shown.map((q) => (
            <li key={q.id} className="flex items-center gap-2.5 rounded-[20px] bg-soft px-3 py-2">
              <Avatar user={q.author} size={26} />
              <span className="min-w-0 flex-1 text-sm leading-snug">{q.text}</span>
              {q.mine && (
                <button type="button" aria-label="Supprimer la question" onClick={() => remove(q)} className="tap grid h-9 w-9 flex-none place-items-center rounded-full border-0 bg-transparent text-mute hover:text-heart">
                  <Trash size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {list.length > 5 && (
        <button type="button" onClick={() => setAll(!all)} className="tap self-start border-0 bg-transparent p-0 text-sm font-bold text-acc">
          {all ? 'Réduire' : `Voir les ${list.length} questions`}
        </button>
      )}
    </div>
  );
}

/** Pas encore de salon : créer, rejoindre, écrire des questions. */
export function WhoisHome() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const connected = useGame((s) => s.connected);
  const run = async (event: 'whois:create' | 'whois:join', c?: string) => {
    setBusy(true);
    await enter(event, c);
    setBusy(false);
  };
  return (
    <div className="flex animate-in flex-col gap-3.5">
      <Hero />
      <div className="card flex flex-col gap-3 p-[18px]">
        <div className="text-[1.0625rem] font-extrabold">
          Jouer à {WHOIS.minPlayers} ou plus (jusqu’à {WHOIS.maxPlayers})
        </div>
        <PrimaryBtn tone="brand" className="h-[60px] rounded-[30px] text-[1.0625rem] font-extrabold" disabled={busy || !connected} onClick={() => run('whois:create')}>
          {connected ? <Plus size={20} weight="bold" /> : <CircleNotch size={20} className="animate-spin" />}
          {connected ? 'Créer un salon' : 'Connexion…'}
        </PrimaryBtn>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) void run('whois:join', code.trim());
          }}
        >
          <input className="field min-w-0 flex-1 font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code du salon (QDN-482)" maxLength={8} autoCapitalize="characters" />
          <button type="submit" disabled={busy || !connected || !code.trim()} className="tap h-12 rounded-3xl border-0 bg-ink px-5 text-[0.9375rem] font-bold text-inv active:scale-95 disabled:bg-line disabled:text-mute">
            Rejoindre
          </button>
        </form>
      </div>
      <QuestionBank />
    </div>
  );
}

function LeaveLink() {
  return (
    <button
      type="button"
      onClick={() => gameEmit('whois:leave')}
      className="tap flex items-center gap-1.5 self-center border-0 bg-transparent px-2 py-2 text-sm font-semibold text-mute underline underline-offset-4"
    >
      <SignOut size={16} /> Quitter le salon
    </button>
  );
}

function WaitHost() {
  return (
    <div className="flex h-14 flex-[1_1_160px] items-center justify-center gap-2 rounded-[28px] bg-glass text-sm font-bold text-mute">
      <HourglassMedium size={18} /> En attente de l’hôte…
    </div>
  );
}

function Lobby({ room, meId }: { room: WhoisRoom; meId: string }) {
  const host = room.hostId === meId;
  const enough = room.players.length >= WHOIS.minPlayers;
  return (
    <div className="flex animate-in flex-col gap-3.5">
      <Hero code={room.code} />
      {room.error && <div className="rounded-3xl bg-card px-4 py-3 text-sm font-semibold text-heart shadow-pill">{room.error}</div>}
      <div className="card flex flex-col gap-3.5 p-[18px]">
        <div className="flex items-center gap-2.5">
          <div className="text-[1.0625rem] font-extrabold">
            Joueurs · {room.players.length}/{WHOIS.maxPlayers}
          </div>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(room.code).then(() => toast('Code copié'))}
            className="tap ml-auto flex items-center gap-1.5 rounded-[14px] border-0 bg-soft px-3 py-2 font-mono text-[0.8125rem] font-semibold text-ink"
            aria-label="Copier le code du salon"
          >
            {room.code} <Copy size={14} />
          </button>
        </div>
        <div className="flex flex-wrap gap-3.5">
          {room.players.map((p) => (
            <div key={p.user.id} className="relative flex w-[60px] flex-col items-center gap-1.5" style={{ opacity: p.connected ? 1 : 0.45 }}>
              <Avatar user={p.user} size={54} />
              {p.user.id === room.hostId && <Crown size={18} weight="fill" className="absolute -top-2 right-0 text-acc" />}
              <span className="max-w-full truncate text-[0.8125rem] font-semibold">{p.user.id === meId ? 'Toi' : first(p.user.displayName)}</span>
            </div>
          ))}
          {room.players.length < WHOIS.maxPlayers && (
            <div className="flex w-[60px] flex-col items-center gap-1.5">
              <button type="button" aria-label="Inviter" onClick={() => openInvite('whois')} className="tap grid h-[54px] w-[54px] place-items-center rounded-full border-2 border-dashed border-[#8FA3B5] bg-transparent text-ink">
                <Plus size={20} />
              </button>
              <span className="text-[0.8125rem] font-semibold">Inviter</span>
            </div>
          )}
        </div>
      </div>
      <div className="card flex flex-wrap items-center gap-3 p-[18px]">
        <div className="mr-auto">
          <div className="text-[1.0625rem] font-extrabold">Questions</div>
          <div className="text-[0.8125rem] text-mute">
            {room.customCount ? `${room.customCount} de la bande dans le paquet` : 'Questions de base (écrivez les vôtres !)'}
          </div>
        </div>
        <Seg
          className={cx(!host && 'pointer-events-none opacity-70')}
          value={room.rounds}
          onChange={(rounds) => gameEmit('whois:settings', { rounds })}
          options={WHOIS.roundOptions.map((n) => ({ value: n as number, label: n }))}
        />
      </div>
      {host ? (
        <button
          type="button"
          disabled={!enough}
          onClick={() => gameEmit('whois:start')}
          className={cx(
            'tap flex h-[60px] items-center justify-center gap-2.5 rounded-[30px] border-0 text-[1.0625rem] font-extrabold transition-transform duration-200',
            enough ? 'bg-brand text-white shadow-blue hover:-translate-y-0.5 active:scale-[.97]' : 'cursor-not-allowed bg-line text-mute',
          )}
        >
          <Play size={20} weight="fill" />
          <span>{enough ? 'Lancer la partie' : `Il faut ${WHOIS.minPlayers} joueurs au moins`}</span>
        </button>
      ) : (
        <WaitHost />
      )}
      <LeaveLink />
    </div>
  );
}

function QuestionHead({ room, children }: { room: WhoisRoom; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-[32px] bg-gradient-to-br from-[#7b2ff7] to-[#e5484d] p-6 text-white shadow-hero">
      <div className="flex items-center gap-2">
        <span className="rounded-[16px] bg-white/15 px-3 py-1.5 text-xs font-bold">
          Question {room.round}/{room.rounds}
        </span>
        {children}
      </div>
      <div className="text-[clamp(22px,5.4vw,32px)] leading-[1.15] font-extrabold tracking-[-.02em] text-balance">{room.question?.text}</div>
      {room.question?.by && (
        <div className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-white/85">
          <Avatar user={room.question.by} size={20} /> Proposée par {first(room.question.by.displayName)}
        </div>
      )}
    </div>
  );
}

function Question({ room, meId }: { room: WhoisRoom; meId: string }) {
  const now = useNow(250);
  const left = room.deadline ? Math.max(0, Math.ceil((new Date(room.deadline).getTime() - now) / 1000)) : 0;
  const voted = room.players.filter((p) => p.voted).length;
  return (
    <div className="flex animate-in flex-col gap-3.5">
      <QuestionHead room={room}>
        <span className={cx('ml-auto flex items-center gap-1 rounded-[16px] px-3 py-1.5 text-xs font-bold tabular-nums', left <= 5 ? 'bg-white text-heart' : 'bg-white/15')}>
          <Timer size={14} weight="bold" /> {left} s
        </span>
      </QuestionHead>
      <div className="px-1 text-sm font-semibold text-mute" aria-live="polite">
        {room.myVote ? 'Tu peux encore changer d’avis.' : 'Touche la personne que tu désignes (toi compris).'} · {voted}/{room.players.length} ont voté
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3" role="group" aria-label="Désigner un joueur">
        {room.players.map((p) => {
          const on = room.myVote === p.user.id;
          return (
            <button
              key={p.user.id}
              type="button"
              aria-pressed={on}
              onClick={() => gameEmit('whois:vote', p.user.id)}
              className={cx(
                'tap flex flex-col items-center gap-2 rounded-[26px] border-2 border-solid p-3 text-ink transition-[background,transform] duration-200 active:scale-[.96]',
                on ? 'border-brand bg-tint' : 'border-transparent bg-card shadow-pill',
              )}
            >
              <span className="relative">
                <Avatar user={p.user} size={64} />
                {on && <CheckCircle size={24} weight="fill" className="absolute -right-1 -bottom-1 rounded-full bg-card text-brand" />}
              </span>
              <span className="max-w-full truncate text-[0.9375rem] font-bold">{p.user.id === meId ? 'Moi' : first(p.user.displayName)}</span>
            </button>
          );
        })}
      </div>
      <LeaveLink />
    </div>
  );
}

function Reveal({ room, meId }: { room: WhoisRoom; meId: string }) {
  const host = room.hostId === meId;
  const top = room.results[0]?.votes ?? 0;
  const total = room.results.reduce((n, r) => n + r.votes, 0);
  const leaders = room.results.filter((r) => top > 0 && r.votes === top);
  const lastRound = room.round >= room.rounds;
  const meLeader = leaders.some((l) => l.user.id === meId);
  return (
    <div className="flex animate-in flex-col gap-3.5">
      <QuestionHead room={room} />
      <div className="card flex flex-col gap-3 p-[18px]">
        <div className="text-center text-xl font-extrabold tracking-[-.02em]" aria-live="polite">
          {top === 0
            ? 'Personne n’a voté…'
            : meLeader
              ? leaders.length > 1
                ? 'Ex æquo… et tu en fais partie !'
                : 'C’est toi ! 🫵'
              : leaders.map((l) => first(l.user.displayName)).join(' et ')}
        </div>
        <div className="flex flex-col gap-2">
          {room.results.map((r, i) => (
            <div key={r.user.id} className="flex items-center gap-2.5">
              <Avatar user={r.user} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between text-sm font-bold">
                  <span className="truncate">{r.user.id === meId ? 'Toi' : r.user.displayName}</span>
                  <span className="tabular-nums">
                    {r.votes} vote{r.votes > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-soft">
                  <div
                    className={cx('h-full rounded-full', r.votes === top && top > 0 ? 'bg-brand' : 'bg-ink/25')}
                    style={{ width: `${total ? (r.votes / total) * 100 : 0}%`, transition: `width .9s cubic-bezier(.2,.9,.2,1) ${i * 0.08}s` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="text-center text-[0.8125rem] text-mute">+{WHOIS.pointsMajority} points pour qui a voté comme la majorité.</div>
      </div>
      <div className="flex flex-wrap gap-2">
        {host ? (
          <PrimaryBtn tone="brand" className="h-14 flex-[1_1_160px] rounded-[28px]" onClick={() => gameEmit('whois:next')}>
            {lastRound ? 'Voir le bilan' : 'Question suivante'}
          </PrimaryBtn>
        ) : (
          <WaitHost />
        )}
      </div>
      <LeaveLink />
    </div>
  );
}

function Final({ room, meId }: { room: WhoisRoom; meId: string }) {
  const host = room.hostId === meId;
  const ranking = [...room.players].sort((a, b) => b.score - a.score);
  return (
    <div className="flex animate-in flex-col gap-3.5">
      <Hero code={room.code} />
      <div className="card flex flex-col gap-2.5 p-[18px]">
        <div className="text-[1.0625rem] font-extrabold">Ceux qui connaissent le mieux la bande</div>
        {ranking.map((p, i) => (
          <div key={p.user.id} className={cx('flex items-center gap-2.5 rounded-[20px] px-3 py-2 text-sm font-semibold', i === 0 && p.score > 0 ? 'bg-tint' : 'bg-soft')}>
            <span className="w-5 text-mute">{i + 1}</span>
            <Avatar user={p.user} size={32} />
            <span className="min-w-0 flex-1 truncate">{p.user.id === meId ? 'Toi' : p.user.displayName}</span>
            <span className="font-extrabold">{p.score} pts</span>
          </div>
        ))}
      </div>
      {room.titles.length > 0 && (
        <div className="card flex flex-col gap-3 p-[18px]">
          <div className="flex items-center gap-2 text-[1.0625rem] font-extrabold">
            <ChatCircleText size={20} weight="fill" /> Les titres de la partie
          </div>
          {room.titles.map((t) => (
            <div key={t.user.id} className="flex gap-2.5">
              <Avatar user={t.user} size={36} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-extrabold">{t.user.id === meId ? 'Toi' : t.user.displayName}</div>
                <ul className="m-0 flex flex-col gap-0.5 pl-4 text-sm text-mute">
                  {t.questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}
      {host ? (
        <PrimaryBtn tone="brand" className="h-14 rounded-[28px]" onClick={() => gameEmit('whois:next')}>
          <UsersThree size={20} weight="fill" /> Rejouer
        </PrimaryBtn>
      ) : (
        <WaitHost />
      )}
      <LeaveLink />
    </div>
  );
}

export function WhoisRoomView({ room, meId }: { room: WhoisRoom; meId: string }) {
  return (
    <div data-screen-label="Qui de nous">
      {room.stage === 'lobby' && <Lobby room={room} meId={meId} />}
      {room.stage === 'question' && <Question room={room} meId={meId} />}
      {room.stage === 'reveal' && <Reveal room={room} meId={meId} />}
      {room.stage === 'final' && <Final room={room} meId={meId} />}
    </div>
  );
}

/** Rejoindre un salon depuis une invitation (`/jeu?code=QDN-123`). */
export const joinWhois = (code: string) => enter('whois:join', code);
