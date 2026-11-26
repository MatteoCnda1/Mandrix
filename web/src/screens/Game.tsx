import { GAME, type GameRoom } from '@mandrix/shared';
import { ArrowRight, CheckCircle, CircleNotch, Copy, Crown, Flag, HourglassMedium, Images, Play, Plus, Shuffle, SignOut, Timer, Trophy } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { DailyMemeView } from '../components/Daily';
import { Avatar, Podium, PrimaryBtn, Seg, WholeMedia, confirmAction, cx } from '../components/ui';
import { qc, useMe, usePoolStats } from '../lib/data';
import { useNow } from '../lib/hooks';
import { gameEmit, useGame, useWhois } from '../lib/socket';
import { openInvite, toast, useUI } from '../lib/store';
import { joinWhois, WhoisHome, WhoisRoomView } from './Whois';

function Hero({ room }: { room?: GameRoom | null }) {
  const { data: pool } = usePoolStats();
  return (
    <div className="flex flex-col gap-3.5 rounded-[32px] bg-hero p-6 text-white shadow-hero">
      <div className="text-[clamp(36px,8vw,56px)] leading-none font-extrabold tracking-[-.05em]">Make It Friends</div>
      <p className="m-0 max-w-[420px] text-base leading-[1.45] text-fog">Une image tirée du pool, une légende à écrire, et tout le monde vote.</p>
      <div className="flex flex-wrap gap-2">
        <span className="flex h-10 items-center gap-2 rounded-[20px] bg-white/15 px-3.5 text-sm font-bold">
          <Images size={18} />
          <span>{(pool?.publicCount ?? 0).toLocaleString('fr-FR')} dans le pool public</span>
        </span>
        {!!pool?.mine && <span className="flex h-10 animate-pop items-center rounded-[20px] bg-brand px-3.5 text-sm font-bold">+{pool.mine} de toi</span>}
        {room && <span className="flex h-10 items-center rounded-[20px] bg-white/15 px-3.5 font-mono text-sm font-semibold">{room.code}</span>}
      </div>
    </div>
  );
}

function GalleryButton() {
  const nav = useNavigate();
  return (
    <button
      type="button"
      onClick={() => nav('/jeu/galerie')}
      className="tap card flex items-center gap-3.5 border-0 py-3.5 pr-[18px] pl-3.5 text-left text-ink transition-transform duration-200 hover:-translate-y-0.5 active:scale-[.98]"
    >
      <span className="grid h-[52px] w-[52px] flex-none place-items-center rounded-full bg-tint">
        <Trophy size={24} weight="fill" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[1.0625rem] font-extrabold">Galerie des mèmes</span>
        <span className="block text-sm text-mute">Classement de la saison et podium des plus aimés</span>
      </span>
      <ArrowRight size={20} />
    </button>
  );
}

/** Entre dans un salon (création ou code) et affiche aussitôt son état. */
async function enterRoom(event: 'game:create' | 'game:join', code?: string) {
  const room = await (code ? gameEmit<GameRoom>(event, code) : gameEmit<GameRoom>(event));
  if (room) useGame.setState({ room });
  return room;
}

/** Pool vide : on explique et on propose d'y ajouter une photo. */
function EmptyPoolCard() {
  return (
    <div className="card flex flex-col gap-3 p-[18px]">
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 flex-none place-items-center rounded-full bg-tint">
          <Images size={22} weight="fill" />
        </span>
        <div className="min-w-0">
          <div className="text-[1.0625rem] font-extrabold">Le pool est vide</div>
          <div className="text-sm text-mute">Il faut au moins une photo ou une vidéo dans le pool pour jouer.</div>
        </div>
      </div>
      <PrimaryBtn onClick={() => useUI.getState().openComposer('post', 0, { pool: true })}>
        <Plus size={18} weight="bold" /> Ajouter une photo au pool
      </PrimaryBtn>
      <p className="m-0 px-1 text-[0.8125rem] text-mute">Tu peux aussi envoyer un post existant ou une photo du déballage avec le bouton « Pool ».</p>
    </div>
  );
}

type Tab = 'live' | 'jour' | 'qdn';

function NoRoom({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const connected = useGame((s) => s.connected);
  const { data: pool } = usePoolStats();
  const run = async (event: 'game:create' | 'game:join', c?: string) => {
    setBusy(true);
    await enterRoom(event, c);
    setBusy(false);
  };
  const tabs = (
    <Seg
      size="sm"
      value={tab}
      onChange={setTab}
      options={[
        { value: 'live' as const, label: 'Mèmes en direct' },
        { value: 'jour' as const, label: 'Mème du jour' },
        { value: 'qdn' as const, label: 'Qui de nous ?' },
      ]}
    />
  );
  if (tab === 'qdn') {
    return (
      <div className="flex animate-in flex-col gap-3.5">
        {tabs}
        <WhoisHome />
      </div>
    );
  }
  if (tab === 'jour') {
    return (
      <div className="flex animate-in flex-col gap-3.5">
        {tabs}
        <DailyMemeView emptyPool={pool && pool.publicCount === 0 ? <EmptyPoolCard /> : null} />
        <GalleryButton />
      </div>
    );
  }
  return (
    <div className="flex animate-in flex-col gap-3.5">
      {tabs}
      <Hero />
      <div className="card flex flex-col gap-3 p-[18px]">
        <div className="text-[1.0625rem] font-extrabold">Jouer avec tes amis</div>
        <PrimaryBtn
          tone="brand"
          className="h-[60px] rounded-[30px] text-[1.0625rem] font-extrabold"
          disabled={busy || !connected}
          onClick={() => run('game:create')}
        >
          {connected ? <Plus size={20} weight="bold" /> : <CircleNotch size={20} className="animate-spin" />}
          {connected ? 'Créer un salon' : 'Connexion…'}
        </PrimaryBtn>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) run('game:join', code.trim());
          }}
        >
          <input className="field flex-1 font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code du salon (MDRX-482)" maxLength={8} autoCapitalize="characters" />
          <button type="submit" disabled={busy || !connected || !code.trim()} className="tap h-12 rounded-3xl border-0 bg-ink px-5 text-[0.9375rem] font-bold text-inv active:scale-95 disabled:bg-line disabled:text-mute">
            Rejoindre
          </button>
        </form>
      </div>
      {pool && pool.publicCount === 0 && <EmptyPoolCard />}
      <GalleryButton />
    </div>
  );
}

function Lobby({ room, meId }: { room: GameRoom; meId: string }) {
  const host = room.hostId === meId;
  const enough = room.players.length >= GAME.minPlayers;
  const { data: pool } = usePoolStats();
  const emptyPool = (!!room.error && /pool est vide/.test(room.error)) || (room.source === 'public' && pool?.publicCount === 0);
  return (
    <div className="flex animate-in flex-col gap-3.5">
      <Hero />
      {emptyPool ? (
        <EmptyPoolCard />
      ) : (
        room.error && <div className="rounded-3xl bg-card px-4 py-3 text-sm font-semibold text-heart shadow-pill">{room.error}</div>
      )}
      <div className="card flex flex-col gap-3.5 p-[18px]">
        <div className="flex items-center gap-2.5">
          <div className="text-[1.0625rem] font-extrabold">
            Joueurs · {room.players.length}/{GAME.maxPlayers}
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
              <span className="max-w-full truncate text-[0.8125rem] font-semibold">{p.user.id === meId ? 'Toi' : p.user.displayName.split(' ')[0]}</span>
            </div>
          ))}
          {room.players.length < GAME.maxPlayers && (
            <div className="flex w-[60px] flex-col items-center gap-1.5">
              <button type="button" aria-label="Inviter" onClick={() => openInvite('mif')} className="tap grid h-[54px] w-[54px] place-items-center rounded-full border-2 border-dashed border-[#8FA3B5] bg-transparent text-ink">
                <Plus size={20} />
              </button>
              <span className="text-[0.8125rem] font-semibold">Inviter</span>
            </div>
          )}
        </div>
      </div>
      <div className="card flex flex-wrap items-center gap-3 p-[18px]">
        <div className="mr-auto text-[1.0625rem] font-extrabold">Manches</div>
        <Seg
          className={cx(!host && 'pointer-events-none opacity-70')}
          value={room.rounds}
          onChange={(rounds) => gameEmit('game:settings', { rounds })}
          options={GAME.roundOptions.map((n) => ({ value: n as number, label: n }))}
        />
      </div>
      <div className="card flex flex-wrap items-center gap-3 p-[18px]">
        <div className="mr-auto text-[1.0625rem] font-extrabold">Images tirées du</div>
        <Seg
          className={cx(!host && 'pointer-events-none opacity-70')}
          value={room.source}
          onChange={(source) => gameEmit('game:settings', { source })}
          options={[
            { value: 'public' as const, label: 'Pool public' },
            { value: 'friends' as const, label: 'Pool amis' },
          ]}
        />
      </div>
      <GalleryButton />
      {host ? (
        <button
          type="button"
          disabled={!enough}
          onClick={() => gameEmit('game:start')}
          className={cx(
            'tap flex h-[60px] items-center justify-center gap-2.5 rounded-[30px] border-0 text-[1.0625rem] font-extrabold transition-transform duration-200',
            enough ? 'bg-brand text-white shadow-blue hover:-translate-y-0.5 active:scale-[.97]' : 'cursor-not-allowed bg-line text-mute',
          )}
        >
          <Play size={20} weight="fill" />
          <span>{enough ? 'Lancer la partie' : 'Invite au moins un ami'}</span>
        </button>
      ) : (
        <div className="flex h-[60px] items-center justify-center gap-2.5 rounded-[30px] bg-glass text-[0.9375rem] font-bold text-mute">
          <HourglassMedium size={20} /> En attente de l’hôte…
        </div>
      )}
      <LeaveLink />
    </div>
  );
}

function LeaveLink() {
  return (
    <button
      type="button"
      onClick={() => gameEmit('game:leave')}
      className="tap flex items-center gap-1.5 self-center border-0 bg-transparent px-2 py-2 text-sm font-semibold text-mute underline underline-offset-4"
    >
      <SignOut size={16} /> Quitter le salon
    </button>
  );
}

function useLeft(deadline: string | null) {
  const now = useNow(250);
  return deadline ? Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000)) : 0;
}

function Caption({ room }: { room: GameRoom }) {
  const left = useLeft(room.deadline);
  const [text, setText] = useState('');
  const submitted = room.me.caption !== null;
  const done = room.players.filter((p) => p.submitted).length;
  const shown = submitted ? room.me.caption! : text;

  return (
    <div className="flex animate-in flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-10 items-center rounded-[20px] bg-ink px-3.5 text-sm font-bold text-inv">
          Manche {room.round}/{room.rounds}
        </span>
        <span className="ml-auto flex h-10 items-center gap-1.5 rounded-[20px] bg-card px-3.5 text-[0.9375rem] font-extrabold tabular-nums">
          <Timer size={18} />
          <span>{left} s</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-glass">
        <div className="h-full rounded bg-brand transition-[width] duration-1000 ease-linear" style={{ width: `${(left / room.seconds) * 100}%` }} />
      </div>
      <div className="card flex flex-col gap-2.5 p-3.5">
        <div className={cx('grid min-h-[66px] place-items-center px-2.5 py-1.5 text-center text-[clamp(20px,4.6vw,26px)] leading-[1.15] font-extrabold tracking-[-.02em] text-balance', shown ? 'text-ink' : 'text-mute')}>
          {shown || 'Ta légende apparaît ici'}
        </div>
        {room.me.image ? (
          <WholeMedia media={room.me.image.media} autoPlay>
            {room.me.image && (
              <span className="absolute bottom-2.5 left-2.5 flex h-9 items-center rounded-[18px] bg-card px-3 text-[0.8125rem] font-bold text-ink">du pool · {room.me.image.by}</span>
            )}
            {!submitted && (
              <>
                <button
                  type="button"
                  aria-label="Signaler cette image"
                  onClick={async () => {
                    if (await confirmAction({ title: 'Signaler cette image ?', message: 'Elle sera retirée du pool en attendant vérification.', confirmLabel: 'Signaler', destructive: true })) {
                      await gameEmit('game:report');
                      toast('Signalement envoyé, image retirée');
                    }
                  }}
                  className="tap absolute right-[62px] bottom-2.5 grid h-11 w-11 place-items-center rounded-full border-0 bg-card text-ink active:scale-90"
                >
                  <Flag size={20} />
                </button>
                <button
                  type="button"
                  aria-label={`Changer d’image (${room.me.shufflesLeft} restants)`}
                  disabled={room.me.shufflesLeft <= 0}
                  onClick={() => gameEmit('game:shuffle')}
                  className={cx(
                    'tap absolute right-2.5 bottom-2.5 grid h-11 w-11 place-items-center rounded-full border-0 bg-ink text-inv transition-transform duration-[400ms] ease-spring active:rotate-180',
                    room.me.shufflesLeft <= 0 && 'opacity-40',
                  )}
                >
                  <Shuffle size={20} />
                  <span className="absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-[0.6875rem] font-extrabold text-white">{room.me.shufflesLeft}</span>
                </button>
              </>
            )}
          </WholeMedia>
        ) : (
          <div className="ph grid aspect-[4/3] place-items-center rounded-3xl font-mono text-xs text-phink">aucune image</div>
        )}
      </div>
      {submitted ? (
        <div className="flex h-16 items-center justify-center gap-2 rounded-[32px] bg-card text-[0.9375rem] font-bold text-mute shadow-card">
          <CheckCircle size={20} weight="fill" className="text-brand" /> Légende envoyée · {done}/{room.players.length}
        </div>
      ) : (
        <form
          className="card flex gap-2 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) gameEmit('game:caption', text.trim());
          }}
        >
          <input className="field flex-1" value={text} onChange={(e) => setText(e.target.value)} maxLength={GAME.captionMax} placeholder="Écris ta légende…" autoFocus />
          <button type="submit" className="tap h-12 rounded-3xl border-0 bg-ink px-5 text-[0.9375rem] font-bold text-inv active:scale-95">
            Valider
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * Vote : tout le monde note le même mème en même temps. Après son vote, on attend les autres ;
 * le mème suivant arrive pour tout le monde quand chacun a voté (ou à la fin du temps).
 */
function Vote({ room }: { room: GameRoom }) {
  const left = useLeft(room.deadline);
  const vote = room.vote;
  const tones = ['bg-card text-ink shadow-pill', 'bg-brand text-white shadow-[0_6px_18px_rgba(14,118,198,.25)]', 'bg-ink text-inv shadow-[0_6px_18px_rgba(11,15,20,.2)]'];
  if (!vote) return null;
  const current = vote.meme;
  const done = current.mine || current.myRating !== null;
  const everyone = vote.voted >= vote.voters;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <div className="text-[1.0625rem] font-extrabold">
          Mème {vote.index}/{vote.total}
        </div>
        <span className="rounded-[14px] bg-soft px-2.5 py-1 text-xs font-bold text-mute" aria-live="polite">
          {vote.voted}/{vote.voters} ont voté
        </span>
        <span className="ml-auto flex h-9 items-center gap-1.5 rounded-[18px] bg-card px-3 text-sm font-extrabold tabular-nums">
          <Timer size={16} /> {left} s
        </span>
      </div>
      <div key={current.id} className="card flex animate-in flex-col gap-2.5 p-3.5">
        <div className="px-2.5 py-2 text-center text-[clamp(20px,4.6vw,26px)] leading-[1.15] font-extrabold tracking-[-.02em] text-balance">{current.caption}</div>
        <WholeMedia media={current.image.media} autoPlay />
      </div>
      {current.mine ? (
        <div className="flex h-14 items-center justify-center gap-2 rounded-[28px] bg-glass text-[0.9375rem] font-bold text-mute">
          <Crown size={18} weight="fill" className="text-acc" /> C’est ton mème : les autres votent…
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Noter ce mème">
          {GAME.ratings.map((r) => {
            const picked = current.myRating === r.value;
            return (
              <button
                key={r.value}
                type="button"
                disabled={done && !picked}
                aria-pressed={picked}
                onClick={() => !done && gameEmit('game:rate', current.id, r.value)}
                className={cx(
                  'tap h-14 rounded-[28px] border-0 text-[0.9375rem] font-bold transition-[transform,opacity] duration-200 active:scale-[.94]',
                  tones[r.value],
                  done && !picked && 'opacity-35',
                  picked && 'ring-4 ring-acc/40',
                )}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      )}
      {done && (
        <div className="flex items-center justify-center gap-2 text-sm font-semibold text-mute" aria-live="polite">
          <HourglassMedium size={16} />
          {everyone ? 'Tout le monde a voté, mème suivant…' : `Vote enregistré · en attente des autres (${vote.voted}/${vote.voters})`}
        </div>
      )}
    </div>
  );
}

function Results({ room, meId }: { room: GameRoom; meId: string }) {
  const nav = useNavigate();
  const host = room.hostId === meId;
  const final = room.stage === 'final';
  // En cas d'égalité, l'auteur du mème gagnant passe devant (podium cohérent avec le mème affiché).
  const winnerId = room.winner?.author.id;
  const ranking = [...room.players].sort(
    (a, b) => (final ? b.score - a.score : b.roundScore - a.roundScore) || Number(b.user.id === winnerId) - Number(a.user.id === winnerId),
  );
  const lastRound = room.round >= room.rounds;
  const [publishing, setPublishing] = useState(false);

  const publish = async () => {
    setPublishing(true);
    await gameEmit('game:publish');
    setPublishing(false);
    for (const k of [['feed'], ['memes']]) qc.invalidateQueries({ queryKey: k });
    toast('Mème publié sur le fil et dans la galerie');
  };

  return (
    <div className="flex animate-in flex-col gap-3.5">
      <div className="card flex flex-col gap-4 p-5">
        <div className="text-[1.375rem] font-extrabold tracking-[-.02em]">{final ? 'Classement final' : `Résultats de la manche ${room.round}`}</div>
        <Podium
          entries={ranking.slice(0, 3).map((p, i) => ({
            key: p.user.id,
            top: (
              <>
                {i === 0 && <Crown size={24} weight="fill" className="text-acc" />}
                <Avatar user={p.user} size={46} />
              </>
            ),
            label: `${p.user.id === meId ? 'Toi' : p.user.displayName.split(' ')[0]} · ${final ? p.score : p.roundScore}`,
          }))}
        />
        {ranking.length > 3 && (
          <div className="flex flex-col gap-1">
            {ranking.slice(3).map((p, i) => (
              <div key={p.user.id} className="flex items-center gap-2.5 rounded-[20px] bg-soft px-3 py-2 text-sm font-semibold">
                <span className="w-5 text-mute">{i + 4}</span>
                <Avatar user={p.user} size={30} />
                <span className="flex-1 truncate">{p.user.id === meId ? 'Toi' : p.user.displayName}</span>
                <span className="font-extrabold">{final ? p.score : p.roundScore}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {room.winner && (
        <div className="card flex flex-col gap-2.5 p-3.5">
          <div className="px-1 text-[0.8125rem] font-bold text-acc">Mème gagnant · {room.winner.author.id === meId ? 'toi' : room.winner.author.displayName}</div>
          <div className="px-2.5 py-1 text-center text-[clamp(20px,4.6vw,26px)] leading-[1.15] font-extrabold tracking-[-.02em] text-balance">{room.winner.caption}</div>
          <WholeMedia media={room.winner.image.media} autoPlay />
        </div>
      )}
      {!room.winner && <div className="card p-5 text-center text-[0.9375rem] text-mute">Personne n’a écrit de légende cette manche.</div>}
      <div className="flex flex-wrap gap-2">
        {room.me.memeId && (
          <PrimaryBtn className="h-14 flex-[1_1_160px] rounded-[28px]" disabled={room.me.published || publishing} onClick={publish}>
            {room.me.published ? 'Mème publié ✓' : 'Publier mon mème'}
          </PrimaryBtn>
        )}
        {host ? (
          <PrimaryBtn tone="brand" className="h-14 flex-[1_1_160px] rounded-[28px]" onClick={() => gameEmit('game:next')}>
            {final ? 'Rejouer' : lastRound ? 'Voir le classement' : 'Manche suivante'}
          </PrimaryBtn>
        ) : (
          <div className="flex h-14 flex-[1_1_160px] items-center justify-center gap-2 rounded-[28px] bg-glass text-sm font-bold text-mute">
            <HourglassMedium size={18} /> En attente de l’hôte…
          </div>
        )}
      </div>
      {final && (
        <button type="button" onClick={() => nav('/jeu/galerie')} className="tap self-center border-0 bg-transparent text-sm font-bold text-acc underline underline-offset-4">
          Voir la galerie des mèmes
        </button>
      )}
      <LeaveLink />
    </div>
  );
}

export function Game() {
  const { data: me } = useMe();
  const room = useGame((s) => s.room);
  const whois = useWhois((s) => s.room);
  const synced = useGame((s) => s.synced);
  const [params, setParams] = useSearchParams();
  // Dernier code rejoint : une nouvelle invitation (autre code) fonctionne même sans quitter l'écran.
  const joined = useRef<string | null>(null);
  const code = params.get('code');

  useEffect(() => {
    if (!code) {
      joined.current = null;
      return;
    }
    if (!synced || joined.current === code) return;
    joined.current = code;
    // Invitation « Qui de nous… ? » (QDN-123) ou Make It Friends (MDRX-123).
    if (/^QDN/i.test(code)) {
      if (whois?.code !== code.toUpperCase()) void joinWhois(code);
      setParams({ onglet: 'qdn' }, { replace: true });
      return;
    }
    if (room?.code !== code.toUpperCase()) void enterRoom('game:join', code);
    setParams({}, { replace: true });
  }, [code, synced]); // eslint-disable-line react-hooks/exhaustive-deps

  const onglet = params.get('onglet');
  const tab: Tab = onglet === 'jour' || onglet === 'qdn' ? onglet : 'live';
  const setTab = (t: Tab) => setParams(t === 'live' ? {} : { onglet: t }, { replace: true });

  if (!me) return null;
  if (whois && (tab === 'qdn' || !room)) return <WhoisRoomView room={whois} meId={me.id} />;
  if (!room) return <NoRoom tab={tab} setTab={setTab} />;
  return (
    <div data-screen-label="Make It Friends">
      {room.stage === 'lobby' && <Lobby room={room} meId={me.id} />}
      {room.stage === 'caption' && <Caption key={room.round} room={room} />}
      {room.stage === 'vote' && <Vote room={room} />}
      {(room.stage === 'results' || room.stage === 'final') && <Results room={room} meId={me.id} />}
    </div>
  );
}
