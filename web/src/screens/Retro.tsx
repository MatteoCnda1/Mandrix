import type { Post, RetroState } from '@mandrix/shared';
import { ArrowCounterClockwise, CaretLeft, CaretRight, X } from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Avatar, MediaView, Portal, WholeMedia, cx } from '../components/ui';
import { useMe, useRetro } from '../lib/data';
import { useSwipeX } from '../lib/gestures';
import { useGoBack } from '../lib/nav';
import { useScrollLock } from '../lib/scrollLock';

// Rétro de l'année (#90) : des diapositives plein écran, à toucher (droite : suivante, gauche : précédente).

const n = (v: number) => v.toLocaleString('fr-FR');
const s = (v: number, one: string, many: string) => `${n(v)} ${v > 1 ? many : one}`;

/** « 3 j’aime · 2 réactions · 1 commentaire » (sans les zéros). */
function postScore(p: Post) {
  const reactions = p.reactions.reduce((sum, r) => sum + r.count, 0);
  const parts = [p.likes && s(p.likes, 'j’aime', 'j’aime'), reactions && s(reactions, 'réaction', 'réactions'), p.comments && s(p.comments, 'commentaire', 'commentaires')].filter(Boolean);
  return parts.join(' · ');
}

interface Slide {
  key: string;
  bg: string;
  body: ReactNode;
}

function Big({ children }: { children: ReactNode }) {
  return <div className="animate-pop text-[clamp(56px,16vw,104px)] leading-[.95] font-extrabold tracking-[-.05em]">{children}</div>;
}

function Line({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <div className="animate-in text-[clamp(18px,4.6vw,24px)] leading-snug font-bold text-white/90" style={{ animationDelay: `${delay}s`, animationFillMode: 'both' }}>
      {children}
    </div>
  );
}

function slidesFor(r: RetroState, meName: string): Slide[] {
  const out: Slide[] = [];
  const push = (key: string, bg: string, body: ReactNode) => out.push({ key, bg, body });

  push(
    'intro',
    'from-[#0e76c6] to-[#7b2ff7]',
    <>
      <Line>{meName}, voici</Line>
      <Big>ta rétro {r.year}</Big>
      <Line delay={0.3}>Une année sur Mandrix, en quelques chiffres.</Line>
    </>,
  );

  if (!r.enough) {
    push(
      'empty',
      'from-[#334155] to-[#0f172a]',
      <>
        <Big>Pas encore assez de souvenirs</Big>
        <Line delay={0.2}>Poste, prends des photos dans la Pellicule et joue avec la bande : ta rétro se remplira au fil de l’année.</Line>
      </>,
    );
    return out;
  }

  if (r.posts.total) {
    const parts = [r.posts.photos && s(r.posts.photos, 'photo', 'photos'), r.posts.videos && s(r.posts.videos, 'vidéo', 'vidéos'), r.posts.polls && s(r.posts.polls, 'sondage', 'sondages')].filter(Boolean);
    push(
      'posts',
      'from-[#d1373c] to-[#b45309]',
      <>
        <Line>Tu as publié</Line>
        <Big>{s(r.posts.total, 'post', 'posts')}</Big>
        {parts.length > 1 && <Line delay={0.2}>{parts.join(', ')}</Line>}
        <Line delay={0.4}>
          {s(r.posts.likes, 'j’aime', 'j’aime')}, {s(r.posts.reactions, 'réaction', 'réactions')} et {s(r.posts.comments, 'commentaire', 'commentaires')} reçus.
        </Line>
      </>,
    );
  }

  if (r.topPost?.media) {
    push(
      'top',
      'from-[#7b2ff7] to-[#d1373c]',
      <>
        <Line>Ton post le plus aimé</Line>
        <div className="ph mx-auto aspect-square w-[min(72vw,340px)] animate-pop overflow-hidden rounded-[28px] shadow-hero">
          <MediaView media={r.topPost.media} sizes="340px" autoPlay />
        </div>
        {r.topPost.text && (
          <Line delay={0.2}>
            <span className="line-clamp-4 break-words">« {r.topPost.text} »</span>
          </Line>
        )}
        {postScore(r.topPost) && <Line delay={0.35}>{postScore(r.topPost)}</Line>}
      </>,
    );
  }

  if (r.pellicule.shots) {
    const p = r.pellicule;
    push(
      'pellicule',
      'from-[#0e76c6] to-[#0e7490]',
      <>
        <Line>Dans la Pellicule</Line>
        <Big>{s(p.shots, 'photo', 'photos')}</Big>
        <Line delay={0.2}>
          sur {s(p.weeks, 'semaine', 'semaines')} · série record : {s(p.bestStreak, 'semaine', 'semaines')}
        </Line>
        {p.onTime > 0 && <Line delay={0.35}>⚡ {s(p.onTime, 'fois', 'fois')} pile à l’heure pour le Moment Mandrix</Line>}
        {p.topShot && (
          <div className="ph mx-auto mt-2 aspect-[3/4] w-[min(44vw,200px)] animate-in overflow-hidden rounded-[22px] shadow-hero" style={{ animationDelay: '.5s', animationFillMode: 'both' }}>
            <MediaView media={p.topShot.media} sizes="200px" />
          </div>
        )}
      </>,
    );
  }

  if (r.memes.count) {
    const m = r.memes;
    push(
      'memes',
      'from-[#111827] to-[#7b2ff7]',
      <>
        <Line>Côté mèmes</Line>
        <Big>{s(m.points, 'point', 'points')}</Big>
        <Line delay={0.2}>
          {s(m.count, 'mème', 'mèmes')} · {s(m.wins, 'victoire', 'victoires')}
        </Line>
        {m.best && (
          <div className="mx-auto mt-2 flex w-[min(72vw,320px)] animate-in flex-col overflow-hidden rounded-[24px] bg-white text-black shadow-hero" style={{ animationDelay: '.4s', animationFillMode: 'both' }}>
            <div className="px-3 py-2.5 text-center text-lg leading-tight font-extrabold">{m.best.caption}</div>
            {/* Le mème en entier, comme partout ailleurs. */}
            <WholeMedia media={m.best.media} sizes="320px" maxH="34svh" className="rounded-none" />
          </div>
        )}
      </>,
    );
  }

  if (r.guesses.played) {
    push(
      'guess',
      'from-[#b45309] to-[#d1373c]',
      <>
        <Line>Qui a pris ça ?</Line>
        <Big>{s(r.guesses.hits, 'bonne réponse', 'bonnes réponses')}</Big>
        <Line delay={0.2}>en {s(r.guesses.played, 'dimanche', 'dimanches')} de devinettes.</Line>
      </>,
    );
  }

  if (r.messages.sent) {
    const t = r.messages.topFriend;
    push(
      'messages',
      'from-[#0e76c6] to-[#15803d]',
      <>
        <Line>Tu as envoyé</Line>
        <Big>{s(r.messages.sent, 'message', 'messages')}</Big>
        {t && (
          <div className="mt-2 flex animate-in items-center justify-center gap-3" style={{ animationDelay: '.25s', animationFillMode: 'both' }}>
            <Avatar user={t.user} size={56} className="shadow-[0_0_0_3px_rgba(255,255,255,.6)]" />
            <div className="text-left">
              <div className="text-sm font-bold text-white">Ton acolyte de l’année</div>
              <div className="text-2xl font-extrabold">{t.user.displayName}</div>
              <div className="text-sm font-semibold text-white">{s(t.count, 'message échangé', 'messages échangés')}</div>
            </div>
          </div>
        )}
        {r.messages.emoji && <Line delay={0.45}>Ta réaction préférée : <span className="text-4xl">{r.messages.emoji}</span></Line>}
      </>,
    );
  }

  push(
    'friends',
    'from-[#15803d] to-[#0e76c6]',
    <>
      <Big>{s(r.friends.total, 'ami', 'amis')}</Big>
      {r.friends.added > 0 && <Line delay={0.2}>dont {n(r.friends.added)} cette année 🤝</Line>}
      {r.busiestMonth && (
        <Line delay={0.4}>
          C’est en <b className="text-white">{r.busiestMonth.label}</b> que tu as été le plus actif.
        </Line>
      )}
    </>,
  );

  push(
    'circle',
    'from-[#7b2ff7] to-[#0e76c6]',
    <>
      <Line>Et toute la bande, en {r.year}</Line>
      <Big>{s(r.circle.posts, 'post', 'posts')}</Big>
      <Line delay={0.2}>
        {s(r.circle.shots, 'photo', 'photos')} dans la Pellicule, {s(r.circle.members, 'membre', 'membres')}.
      </Line>
    </>,
  );

  push(
    'outro',
    'from-[#d1373c] to-[#7b2ff7]',
    <>
      <Big>Merci pour {r.year} 💙</Big>
      <Line delay={0.2}>Rendez-vous en {r.year + 1} pour de nouveaux souvenirs.</Line>
    </>,
  );
  return out;
}

export function Retro() {
  const [params] = useSearchParams();
  const year = Number(params.get('annee')) || undefined;
  const { data: me } = useMe();
  const { data, isLoading, error } = useRetro(year);
  const back = useGoBack();
  const goBack = () => back(-1, '/');
  const [i, setI] = useState(0);
  useScrollLock();

  const slides = data && me ? slidesFor(data, me.displayName.split(' ')[0]) : [];
  const last = slides.length - 1;
  const go = (d: number) => setI((x) => Math.max(0, Math.min(last, x + d)));
  const swipe = useSwipeX((dir) => go(dir === -1 ? 1 : -1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'Escape') goBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const slide = slides[Math.min(i, last)];
  return (
    <Portal>
      <div
        className={cx('fixed inset-0 z-[55] flex flex-col bg-gradient-to-br text-white transition-[background] duration-500', slide?.bg ?? 'from-[#0e76c6] to-[#7b2ff7]')}
        role="dialog"
        aria-label={data ? `Rétro ${data.year}` : 'Rétro de l’année'}
        {...swipe.handlers}
      >
        <div className="flex flex-none items-center gap-2 px-4" style={{ paddingTop: 'calc(12px + var(--safe-t, env(safe-area-inset-top)))' }}>
          <div className="flex flex-1 gap-1" aria-hidden>
            {slides.map((sl, k) => (
              <span key={sl.key} className={cx('h-1 flex-1 rounded-full transition-colors', k <= i ? 'bg-white' : 'bg-white/30')} />
            ))}
          </div>
          <button type="button" aria-label="Fermer la rétro" onClick={goBack} className="tap grid h-11 w-11 flex-none place-items-center rounded-full border-0 bg-white/15 text-white">
            <X size={20} weight="bold" />
          </button>
        </div>
        <div className="relative min-h-0 flex-1">
          {isLoading && <div className="grid h-full place-items-center text-lg font-bold text-white/80">Préparation de ta rétro…</div>}
          {error && <div className="grid h-full place-items-center px-8 text-center text-lg font-bold">Impossible de charger la rétro pour l’instant.</div>}
          {slide && (
            // `justify-center-safe` : un contenu trop haut commence en haut au lieu d'être coupé.
            <div key={slide.key} className="flex h-full flex-col items-center justify-center-safe gap-4 overflow-y-auto px-7 py-6 text-center" aria-live="polite">
              {slide.body}
            </div>
          )}
          {/* Zones de toucher : gauche = précédente, droite = suivante. */}
          {slides.length > 1 && (
            <>
              <button type="button" aria-label="Diapositive précédente" onClick={() => go(-1)} className="absolute inset-y-0 left-0 w-1/3 border-0 bg-transparent" />
              <button type="button" aria-label="Diapositive suivante" onClick={() => go(1)} className="absolute inset-y-0 right-0 w-2/3 border-0 bg-transparent" />
            </>
          )}
        </div>
        <div className="flex flex-none items-center justify-center gap-3 px-4" style={{ paddingBottom: 'calc(18px + env(safe-area-inset-bottom))' }}>
          <button type="button" aria-label="Précédente" disabled={i === 0} onClick={() => go(-1)} className="tap grid h-11 w-11 place-items-center rounded-full border-0 bg-white/15 text-white disabled:opacity-30">
            <CaretLeft size={20} weight="bold" />
          </button>
          {i === last && slides.length > 1 ? (
            <button type="button" onClick={() => setI(0)} className="tap flex h-11 items-center gap-2 rounded-full border-0 bg-white px-5 text-sm font-extrabold text-black">
              <ArrowCounterClockwise size={18} weight="bold" /> Revoir
            </button>
          ) : (
            <span className="min-w-16 text-center text-sm font-bold text-white tabular-nums">{slides.length ? `${i + 1}/${slides.length}` : ''}</span>
          )}
          <button type="button" aria-label="Suivante" disabled={i >= last} onClick={() => go(1)} className="tap grid h-11 w-11 place-items-center rounded-full border-0 bg-white/15 text-white disabled:opacity-30">
            <CaretRight size={20} weight="bold" />
          </button>
        </div>
      </div>
    </Portal>
  );
}
