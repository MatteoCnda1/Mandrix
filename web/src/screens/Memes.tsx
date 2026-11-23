import { Heart, Trophy } from '@phosphor-icons/react';
import { useNavigate } from 'react-router';
import { SeasonBoard } from '../components/Daily';
import { Avatar, EmptyCard, MediaView, Podium, PrimaryBtn, ScreenLoader, cx } from '../components/ui';
import { toggleLike, useMemes } from '../lib/data';
import { fmtCount } from '../lib/format';

export function Memes() {
  const nav = useNavigate();
  const { data, isLoading } = useMemes();
  if (isLoading) return <ScreenLoader />;
  const items = data?.items ?? [];
  const podium = data?.podium ?? [];

  return (
    <div data-screen-label="Galerie des mèmes" className="flex animate-in flex-col gap-3.5">
      <SeasonBoard />
      <div className="card flex flex-col gap-4 p-5">
        <div className="text-[1.375rem] font-extrabold tracking-[-.02em]">Podium des plus aimés</div>
        {podium.length > 0 ? (
          <Podium
            height={260}
            heights={['130px', '96px', '70px']}
            entries={podium.map((p) => ({
              key: p.id,
              top: <Avatar user={p.author} size={46} />,
              label: <span className="line-clamp-2 text-xs font-semibold whitespace-normal text-mute">{p.text}</span>,
              sub: (
                <div className="flex items-center gap-1 text-[0.8125rem] font-extrabold">
                  <Heart size={14} weight="fill" className="text-heart" />
                  <span>{fmtCount(p.likes)}</span>
                </div>
              ),
            }))}
          />
        ) : (
          <p className="m-0 text-[0.9375rem] text-mute">Le podium se remplira avec les mèmes publiés depuis Make It Friends.</p>
        )}
      </div>
      {items.length === 0 ? (
        <EmptyCard icon={<Trophy size={30} weight="fill" />} title="Aucun mème pour l’instant" text="Lance une partie de Make It Friends et publie ta meilleure légende.">
          <PrimaryBtn tone="brand" onClick={() => nav('/jeu')}>
            Jouer
          </PrimaryBtn>
        </EmptyCard>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
          {items.map((m) => (
            <article key={m.id} className="card flex flex-col gap-2.5 p-3">
              <div className="grid min-h-11 place-items-center px-1.5 py-0.5 text-center text-[1.0625rem] leading-tight font-extrabold tracking-[-.02em] text-balance">{m.text}</div>
              <div className="ph aspect-[4/3] overflow-hidden rounded-[20px]">{m.media && <MediaView media={m.media} autoPlay={m.media.kind === 'video'} sizes="(max-width: 600px) 100vw, 340px" />}</div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => nav(`/u/${m.author.username}`)} className="tap truncate border-0 bg-transparent pl-1 text-[0.8125rem] text-mute">
                  Légende de {m.author.displayName}
                </button>
                <button
                  type="button"
                  onClick={() => toggleLike(m)}
                  className="tap ml-auto flex h-11 items-center gap-1.5 rounded-[22px] border-0 bg-soft px-3.5 text-sm font-semibold text-ink transition-transform active:scale-[.92]"
                >
                  <Heart size={20} weight={m.liked ? 'fill' : 'regular'} className={cx(m.liked && 'animate-pop text-heart')} />
                  <span>{fmtCount(m.likes)}</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
