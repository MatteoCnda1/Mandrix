import type { Me } from '@mandrix/shared';
import { ArrowRight, Camera, House, Sticker } from '@phosphor-icons/react';
import { useState, type FormEvent } from 'react';
import { Logo, cx } from '../components/ui';
import { api, errMsg } from '../lib/api';
import { qc, useConfig } from '../lib/data';

type Mode = 'signup' | 'login' | 'forgot';

const sponsorFromUrl = () => {
  try {
    return new URLSearchParams(location.search).get('parrain')?.trim().toUpperCase() ?? '';
  } catch {
    return '';
  }
};

export function Landing() {
  const { data: config } = useConfig();
  const [mode, setMode] = useState<Mode>('signup');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState(sponsorFromUrl);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === 'forgot') {
        await api('/api/auth/forgot', { body: { email } });
        setInfo('Si un compte existe pour cette adresse, un lien de réinitialisation vient d’être envoyé.');
      } else {
        const me =
          mode === 'signup'
            ? await api<Me>('/api/auth/register', { body: { username, email, password, inviteCode: invite || undefined } })
            : await api<Me>('/api/auth/login', { body: { login: email, password } });
        qc.setQueryData(['me'], me);
      }
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const switchTo = (m: Mode) => {
    setMode(m);
    setError(null);
    setInfo(null);
  };

  const field = 'field h-[52px] rounded-[26px] px-5';
  return (
    <div className="min-h-dvh font-sans text-ink">
      <div
        className="mx-auto flex min-h-dvh max-w-[1120px] animate-in flex-wrap items-center gap-[clamp(32px,6vw,72px)]"
        style={{ padding: 'clamp(24px,5vw,56px)', paddingTop: 'calc(clamp(24px,5vw,56px) + env(safe-area-inset-top))', animationDuration: '.6s' }}
      >
        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-[22px]">
          <Logo size={72} />
          <h1 className="m-0 font-script text-[clamp(76px,13vw,140px)] leading-[.95] font-normal">Mandrix</h1>
          <p className="m-0 max-w-[440px] text-lg leading-normal text-pretty text-body">
            Poste, vote et joue avec tes amis. Chaque dimanche à 20h, tout le monde déballe les photos de la semaine.
          </p>
          <form onSubmit={submit} className="flex max-w-[440px] flex-col gap-2.5 rounded-[32px] bg-card p-3.5 shadow-[0_10px_30px_rgba(20,90,160,.12)]">
            {mode === 'signup' && (
              <input
                className={field}
                placeholder="Pseudo"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
                autoComplete="username"
                autoCapitalize="none"
                required
                minLength={3}
                maxLength={20}
              />
            )}
            <input
              className={field}
              type={mode === 'login' ? 'text' : 'email'}
              placeholder={mode === 'login' ? 'E-mail ou pseudo' : 'Adresse e-mail'}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete={mode === 'login' ? 'username' : 'email'}
              autoCapitalize="none"
              required
            />
            {mode !== 'forgot' && (
              <input
                className={field}
                type="password"
                placeholder="Mot de passe"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                minLength={mode === 'signup' ? 8 : 1}
              />
            )}
            {mode === 'signup' && config?.inviteRequired && (
              <input
                className={field}
                placeholder="Code de parrainage (ex. LEA-7K2F)"
                value={invite}
                onChange={(e) => setInvite(e.target.value.toUpperCase())}
                autoCapitalize="characters"
                required
              />
            )}
            {mode === 'signup' && config?.inviteRequired && !invite && (
              <div className="px-3 text-[13px] leading-snug text-mute">Mandrix se rejoint sur invitation : demande son code de parrainage à un ami déjà inscrit.</div>
            )}
            {error && <div className="px-3 text-sm font-semibold text-heart" role="alert">{error}</div>}
            {info && <div className="px-3 text-sm font-semibold text-acc">{info}</div>}
            <button
              type="submit"
              disabled={busy}
              className={cx(
                'tap flex h-[54px] items-center justify-center gap-2.5 rounded-[27px] border-0 bg-ink text-base font-bold text-inv transition-[transform,background] duration-200 hover:bg-brand active:scale-[.97]',
                busy && 'opacity-70',
              )}
            >
              <span>{mode === 'signup' ? 'Créer mon compte' : mode === 'login' ? 'Se connecter' : 'Envoyer le lien'}</span>
              <ArrowRight size={20} />
            </button>
          </form>
          <div className="flex flex-wrap gap-x-4">
            <button
              type="button"
              onClick={() => switchTo(mode === 'signup' ? 'login' : 'signup')}
              className="tap self-start border-0 bg-transparent px-1 py-2.5 text-[15px] font-semibold text-ink underline underline-offset-4"
            >
              {mode === 'signup' ? 'J’ai déjà un compte' : 'Créer un compte'}
            </button>
            {mode === 'login' && config?.mailEnabled && (
              <button type="button" onClick={() => switchTo('forgot')} className="tap self-start border-0 bg-transparent px-1 py-2.5 text-[15px] font-semibold text-mute underline underline-offset-4">
                Mot de passe oublié ?
              </button>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-5 px-2">
          <div className="w-[min(100%,340px)] -rotate-3 self-start">
            <div className="flex animate-float items-center gap-3.5 rounded-[30px] bg-card p-[18px] shadow-float">
              <div className="grid h-[52px] w-[52px] flex-none place-items-center rounded-full bg-ink text-inv">
                <House size={24} weight="fill" />
              </div>
              <div>
                <div className="text-lg font-extrabold">Le fil</div>
                <div className="text-sm leading-[1.4] text-mute">Posts, vidéos et sondages de tes amis.</div>
              </div>
            </div>
          </div>
          <div className="w-[min(100%,340px)] rotate-[2.5deg] self-end">
            <div className="flex animate-float items-center gap-3.5 rounded-[30px] bg-hero p-[18px] text-white shadow-hero" style={{ animationDelay: '-2s' }}>
              <div className="grid h-[52px] w-[52px] flex-none place-items-center rounded-full bg-white text-night">
                <Sticker size={24} weight="fill" />
              </div>
              <div>
                <div className="text-lg font-extrabold tracking-[-.03em]">Make It Friends</div>
                <div className="text-sm leading-[1.4] text-fog">Tes photos deviennent des mèmes à légender.</div>
              </div>
            </div>
          </div>
          <div className="w-[min(100%,340px)] -rotate-[1.5deg] self-center">
            <div className="flex animate-float items-center gap-3.5 rounded-[30px] bg-brand p-[18px] text-white shadow-blue" style={{ animationDelay: '-4s' }}>
              <div className="grid h-[52px] w-[52px] flex-none place-items-center rounded-full bg-card text-acc">
                <Camera size={24} weight="fill" />
              </div>
              <div>
                <div className="text-lg font-extrabold">La Pellicule</div>
                <div className="text-sm leading-[1.4]">Des photos toute la semaine, déballées le dimanche.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
