import type { Me } from '@mandrix/shared';
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Logo, PrimaryBtn } from '../components/ui';
import { api, errMsg } from '../lib/api';
import { qc } from '../lib/data';

export function ResetPassword() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) return setError('Les deux mots de passe ne correspondent pas');
    setBusy(true);
    setError(null);
    try {
      const me = await api<Me>('/api/auth/reset', { body: { token: params.get('token') ?? '', password: pw } });
      qc.setQueryData(['me'], me);
      nav('/', { replace: true });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center p-6 font-sans text-ink">
      <form onSubmit={submit} className="card flex w-full max-w-[420px] animate-in flex-col gap-3 p-5">
        <div className="flex items-center gap-3">
          <Logo size={40} />
          <div className="font-script text-4xl leading-none">Mandrix</div>
        </div>
        <div className="text-xl font-extrabold tracking-[-.02em]">Nouveau mot de passe</div>
        <input className="field" type="password" placeholder="Nouveau mot de passe" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        <input className="field" type="password" placeholder="Confirme le mot de passe" minLength={8} required value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
        {error && <div className="px-2 text-sm font-semibold text-heart">{error}</div>}
        <PrimaryBtn type="submit" disabled={busy}>
          Enregistrer
        </PrimaryBtn>
      </form>
    </div>
  );
}
