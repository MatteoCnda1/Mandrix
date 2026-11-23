import { NOTIF_CATEGORIES, type BlockedUser, type Me, type NotifCategory, type NotificationPrefs, type SessionInfo } from '@mandrix/shared';
import {
  BellRinging,
  DeviceMobile,
  DownloadSimple,
  EnvelopeSimple,
  Key,
  MoonStars,
  Prohibit,
  Trash,
} from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Avatar, confirmAction, cx, PrimaryBtn, ScreenLoader, Switch } from '../components/ui';
import { api, errMsg } from '../lib/api';
import { qc, useConfig, useMe } from '../lib/data';
import { timeAgo } from '../lib/format';
import { currentSubscription, disablePush, enablePush, pushSupported } from '../lib/push';
import { downloadFile } from '../lib/download';
import { disconnectSocket } from '../lib/socket';
import { toast } from '../lib/store';
import { AMBIANCES, useAmbiance } from '../lib/theme';

function Section({ title, children, footer }: { title: string; children: ReactNode; footer?: string }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="m-0 px-3 text-[0.8125rem] font-bold tracking-wide text-mute uppercase">{title}</h2>
      <div className="card flex flex-col gap-0.5 p-2">{children}</div>
      {footer && <p className="m-0 px-3 text-[0.8125rem] text-mute">{footer}</p>}
    </section>
  );
}

function ToggleRow({ label, sub, on, onChange, icon }: { label: string; sub?: string; on: boolean; onChange: (v: boolean) => void; icon?: ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="tap flex min-h-14 items-center gap-3 rounded-3xl border-0 bg-transparent px-2 text-left text-ink hover:bg-soft"
    >
      {icon && <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-soft">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] font-bold">{label}</span>
        {sub && <span className="block text-[0.8125rem] text-mute">{sub}</span>}
      </span>
      <Switch on={on} />
    </button>
  );
}

function ActionRow({ icon, label, sub, onClick, danger, open }: { icon: ReactNode; label: string; sub?: string; onClick: () => void; danger?: boolean; open?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={cx('tap flex min-h-14 items-center gap-3 rounded-3xl border-0 bg-transparent px-2 text-left hover:bg-soft', danger ? 'text-heart' : 'text-ink')}
    >
      <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-soft">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] font-bold">{label}</span>
        {sub && <span className="block truncate text-[0.8125rem] text-mute">{sub}</span>}
      </span>
    </button>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function NotificationSettings({ me }: { me: Me }) {
  const { data: config } = useConfig();
  const [push, setPush] = useState<boolean | null>(null);
  const prefs = me.notificationPrefs ?? {};

  useEffect(() => {
    currentSubscription().then((s) => setPush(!!s));
  }, []);

  const save = async (patch: NotificationPrefs) => {
    try {
      qc.setQueryData(['me'], await api<Me>('/api/me/notifications', { method: 'PATCH', body: patch }));
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const togglePush = async () => {
    try {
      if (push) {
        await disablePush();
        setPush(false);
      } else {
        if (!config?.vapidPublicKey) throw new Error('Notifications push indisponibles sur ce serveur');
        await enablePush(config.vapidPublicKey);
        setPush(true);
      }
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const quiet = prefs.quiet ?? null;
  const on = (kind: 'push' | 'bell', key: NotifCategory) => prefs[kind]?.[key] !== false;

  return (
    <>
      <Section title="Notifications" footer="Le déballage du dimanche reste activé tant que tu ne le coupes pas.">
        {pushSupported() && (
          <ToggleRow icon={<BellRinging size={20} />} label="Notifications sur cet appareil" sub="Alertes même app fermée" on={!!push} onChange={togglePush} />
        )}
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 px-2 pt-2 pb-1 text-xs font-bold text-mute uppercase">
          <span>Type</span>
          <span className="w-[52px] text-center">Push</span>
          <span className="w-[52px] text-center">Cloche</span>
        </div>
        {NOTIF_CATEGORIES.map((c) => (
          <div key={c.key} className="grid min-h-12 grid-cols-[1fr_auto_auto] items-center gap-x-3 rounded-2xl px-2">
            <span className="text-[0.9375rem] font-semibold">{c.label}</span>
            <button
              type="button"
              role="switch"
              aria-checked={on('push', c.key)}
              aria-label={`${c.label} : push`}
              onClick={() => save({ push: { [c.key]: !on('push', c.key) } })}
              className="tap w-[52px] border-0 bg-transparent p-0"
            >
              <Switch on={on('push', c.key)} />
            </button>
            {c.key === 'messages' ? (
              <span className="w-[52px] text-center text-xs text-mute">—</span>
            ) : (
              <button
                type="button"
                role="switch"
                aria-checked={on('bell', c.key)}
                aria-label={`${c.label} : cloche`}
                onClick={() => save({ bell: { [c.key]: !on('bell', c.key) } })}
                className="tap w-[52px] border-0 bg-transparent p-0"
              >
                <Switch on={on('bell', c.key)} />
              </button>
            )}
          </div>
        ))}
      </Section>

      <Section title="Heures calmes" footer="Pendant ces heures, aucune alerte ne sonne : tout attend dans la cloche.">
        <ToggleRow
          icon={<MoonStars size={20} />}
          label="Activer les heures calmes"
          sub={quiet ? `De ${quiet.start} h à ${quiet.end} h` : 'Par exemple de 23 h à 8 h'}
          on={!!quiet}
          onChange={(v) => save({ quiet: v ? { start: 23, end: 8 } : null })}
        />
        {quiet && (
          <div className="flex items-center gap-2 px-2 py-2 text-[0.9375rem] font-semibold">
            <span>De</span>
            <select className="field h-11 w-auto px-3" value={quiet.start} onChange={(e) => save({ quiet: { ...quiet, start: +e.target.value } })} aria-label="Début">
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {h} h
                </option>
              ))}
            </select>
            <span>à</span>
            <select className="field h-11 w-auto px-3" value={quiet.end} onChange={(e) => save({ quiet: { ...quiet, end: +e.target.value } })} aria-label="Fin">
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {h} h
                </option>
              ))}
            </select>
          </div>
        )}
      </Section>
    </>
  );
}

function AmbianceSettings() {
  const [ambiance, setAmbiance] = useAmbiance();
  return (
    <Section title="Ambiance" footer="Mémorisée sur cet appareil. « Réduire les animations » du téléphone fige toutes les ambiances.">
      <div className="grid grid-cols-2 gap-2 p-1" role="radiogroup" aria-label="Ambiance de fond">
        {AMBIANCES.map((a) => (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={ambiance === a.id}
            onClick={() => setAmbiance(a.id)}
            className={cx(
              'tap flex flex-col gap-2 overflow-hidden rounded-[22px] border-0 bg-soft p-2 text-left text-ink transition-shadow',
              ambiance === a.id && 'shadow-[inset_0_0_0_3px_var(--color-brand)]',
            )}
          >
            <span className={cx('ambiance-preview relative block h-20 overflow-hidden rounded-[16px]')} data-preview={a.id} aria-hidden />
            <span className="px-1 text-[0.9375rem] font-bold">{a.label}</span>
            <span className="px-1 pb-1 text-xs text-mute">{a.text}</span>
          </button>
        ))}
      </div>
    </Section>
  );
}

function AccountSettings({ me }: { me: Me }) {
  const nav = useNavigate();
  const [open, setOpen] = useState<'email' | 'password' | 'delete' | null>(null);
  const [email, setEmail] = useState(me.email);
  const [pw, setPw] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<SessionInfo[]>('/api/me/sessions') });
  const blocks = useQuery({ queryKey: ['blocks'], queryFn: () => api<BlockedUser[]>('/api/me/blocks') });

  const toggle = (k: typeof open) => {
    setOpen(open === k ? null : k);
    setPw('');
    setNext('');
    setConfirm('');
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Section title="Compte">
        <ActionRow icon={<EnvelopeSimple size={20} />} label="Adresse e-mail" sub={me.email} onClick={() => toggle('email')} open={open === 'email'} />
        {open === 'email' && (
          <form
            className="flex flex-col gap-2 px-2 pb-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                qc.setQueryData(['me'], await api<Me>('/api/me/email', { body: { email, password: pw } }));
                toast('Adresse e-mail modifiée');
                toggle(null);
              });
            }}
          >
            <input className="field" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Nouvelle adresse" required />
            <input className="field" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Mot de passe actuel" required />
            <PrimaryBtn type="submit" disabled={busy}>
              Enregistrer
            </PrimaryBtn>
          </form>
        )}
        <ActionRow icon={<Key size={20} />} label="Mot de passe" sub="Les autres appareils seront déconnectés" onClick={() => toggle('password')} open={open === 'password'} />
        {open === 'password' && (
          <form
            className="flex flex-col gap-2 px-2 pb-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api('/api/me/password', { body: { current: pw, next } });
                qc.invalidateQueries({ queryKey: ['sessions'] });
                toast('Mot de passe modifié');
                toggle(null);
              });
            }}
          >
            <input className="field" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Mot de passe actuel" required />
            <input
              className="field"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder="Nouveau mot de passe (8 caractères min.)"
              required
            />
            <PrimaryBtn type="submit" disabled={busy}>
              Changer le mot de passe
            </PrimaryBtn>
          </form>
        )}
        <ActionRow
          icon={<DownloadSimple size={20} />}
          label="Exporter mes données"
          sub="Archive zip : profil, posts, messages, photos"
          onClick={() =>
            void run(async () => {
              toast('Préparation de l’archive…');
              await downloadFile('/api/me/export', 'mandrix-export.zip');
            })
          }
        />
      </Section>

      <Section title="Appareils connectés">
        {sessions.isLoading && <div className="p-3 text-sm text-mute">Chargement…</div>}
        {sessions.data?.map((s) => (
          <div key={s.id} className="flex min-h-14 items-center gap-3 px-2">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-soft">
              <DeviceMobile size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.9375rem] font-bold">
                {s.device}
                {s.current && <span className="ml-1.5 rounded-full bg-tint px-2 py-0.5 text-xs font-bold text-acc">Cet appareil</span>}
              </span>
              <span className="block text-[0.8125rem] text-mute">Actif {timeAgo(s.lastSeenAt ?? s.createdAt)}</span>
            </span>
            {!s.current && (
              <button
                type="button"
                className="tap h-10 rounded-[20px] border-0 bg-soft px-3.5 text-[0.8125rem] font-bold text-heart"
                onClick={() =>
                  void run(async () => {
                    await api(`/api/me/sessions/${s.id}`, { method: 'DELETE' });
                    qc.invalidateQueries({ queryKey: ['sessions'] });
                  })
                }
              >
                Déconnecter
              </button>
            )}
          </div>
        ))}
        {(sessions.data?.length ?? 0) > 1 && (
          <button
            type="button"
            className="tap m-1 h-11 rounded-[22px] border-0 bg-soft text-sm font-bold text-heart"
            onClick={() =>
              void run(async () => {
                await api('/api/me/sessions/others', { method: 'DELETE' });
                qc.invalidateQueries({ queryKey: ['sessions'] });
                toast('Les autres appareils sont déconnectés');
              })
            }
          >
            Déconnecter tous les autres appareils
          </button>
        )}
      </Section>

      <Section title="Comptes bloqués" footer="Une personne bloquée ne voit plus tes contenus et ne peut plus t’écrire.">
        {blocks.data?.length === 0 && <div className="px-3 py-3 text-sm text-mute">Personne.</div>}
        {blocks.data?.map((u) => (
          <div key={u.id} className="flex min-h-14 items-center gap-3 px-2">
            <Avatar user={u} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.9375rem] font-bold">{u.displayName}</span>
              <span className="block truncate text-[0.8125rem] text-mute">@{u.username}</span>
            </span>
            <button
              type="button"
              className="tap h-10 rounded-[20px] border-0 bg-soft px-3.5 text-[0.8125rem] font-bold text-ink"
              onClick={() =>
                void run(async () => {
                  await api(`/api/users/${u.id}/block`, { method: 'DELETE' });
                  qc.invalidateQueries({ queryKey: ['blocks'] });
                  qc.invalidateQueries({ queryKey: ['profile'] });
                  toast(`${u.displayName} est débloqué·e`);
                })
              }
            >
              Débloquer
            </button>
          </div>
        ))}
      </Section>

      <Section title="Zone sensible">
        <ActionRow icon={<Trash size={20} />} label="Supprimer mon compte" sub="Définitif : posts, messages, photos" danger onClick={() => toggle('delete')} open={open === 'delete'} />
        {open === 'delete' && (
          <form
            className="flex flex-col gap-2 px-2 pb-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const ok = await confirmAction({
                  title: 'Supprimer ton compte ?',
                  message: 'Tes posts, messages, photos et vidéos seront effacés. Impossible de revenir en arrière.',
                  confirmLabel: 'Supprimer définitivement',
                  destructive: true,
                });
                if (!ok) return;
                await api('/api/me', { method: 'DELETE', body: { password: pw, confirm } });
                disconnectSocket();
                qc.clear();
                qc.setQueryData(['me'], null);
                nav('/', { replace: true });
              });
            }}
          >
            <p className="m-0 text-[0.8125rem] text-mute">Pense à exporter tes données avant. Écris SUPPRIMER puis ton mot de passe pour confirmer.</p>
            <input className="field" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="SUPPRIMER" autoCapitalize="characters" required />
            <input className="field" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Mot de passe" required />
            <PrimaryBtn type="submit" tone="danger" disabled={busy || confirm !== 'SUPPRIMER'}>
              <Prohibit size={18} weight="bold" /> Supprimer mon compte
            </PrimaryBtn>
          </form>
        )}
      </Section>
    </>
  );
}

export function SettingsPage() {
  const { data: me } = useMe();
  if (!me) return <ScreenLoader />;
  return (
    <div data-screen-label="Réglages" className="flex animate-in flex-col gap-5">
      <NotificationSettings me={me} />
      <AmbianceSettings />
      <AccountSettings me={me} />
    </div>
  );
}
