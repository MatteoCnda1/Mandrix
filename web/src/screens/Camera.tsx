import type { PelliculeState } from '@mandrix/shared';
import { ArrowCounterClockwise, ArrowRight, CameraRotate, CloudArrowUp, Fire, ImageSquare, Lightning, LockSimple, WarningCircle } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { cx, useFilePicker, confirmAction } from '../components/ui';
import { errMsg, api } from '../lib/api';
import { qc, usePellicule } from '../lib/data';
import { enqueueShot, flushQueue, NetworkError, onQueueChange, pendingCount, uploadShot } from '../lib/pelliculeQueue';
import { countdown } from '../lib/format';
import { useNow } from '../lib/hooks';
import { toast } from '../lib/store';

type CamState = 'starting' | 'live' | 'denied' | 'unavailable';

function useCamera(facing: 'user' | 'environment') {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<CamState>('starting');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unavailable');
      return;
    }
    setState('starting');
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        // iOS coupe la caméra quand l'app passe en arrière-plan : on la relance au retour.
        s.getVideoTracks()[0]?.addEventListener('ended', () => !cancelled && setRetry((r) => r + 1));
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().catch(() => {});
        }
        setState('live');
      })
      .catch((e: DOMException) => setState(e.name === 'NotAllowedError' ? 'denied' : 'unavailable'));
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || cancelled) return;
      const track = stream?.getVideoTracks()[0];
      if (stream && (!track || track.readyState === 'ended' || track.muted)) setRetry((r) => r + 1);
      else videoRef.current?.play().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [facing, retry]);

  const capture = useCallback(async (): Promise<Blob | null> => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d')!;
    if (facing === 'user') {
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0);
    return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  }, [facing]);

  return { videoRef, state, capture, retry: () => setRetry((n) => n + 1) };
}

const DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/** Nombre de photos en attente d'envoi (prises hors ligne). */
function usePendingShots() {
  const [n, setN] = useState(0);
  useEffect(() => {
    void pendingCount().then(setN);
    return onQueueChange(setN);
  }, []);
  return n;
}

export function Camera() {
  const nav = useNavigate();
  const { data: pel } = usePellicule();
  const [facing, setFacing] = useState<'user' | 'environment'>('environment');
  const cam = useCamera(facing);
  const [flash, setFlash] = useState(false);
  const [bump, setBump] = useState(0);
  const [sending, setSending] = useState(0);
  const now = useNow(1000);
  const cd = countdown(pel?.nextRevealAt, now);
  const todayIdx = (new Date(now).getDay() + 6) % 7;

  const pending = usePendingShots();
  const momentLeft = pel?.moment ? Math.max(0, Math.floor((new Date(pel.moment.endsAt).getTime() - now) / 1000)) : 0;

  useEffect(() => {
    // Fin du « Moment Mandrix » : on rafraîchit l'état.
    if (pel?.moment && momentLeft === 0) qc.invalidateQueries({ queryKey: ['pellicule'] });
  }, [pel?.moment, momentLeft]);

  const send = async (blob: Blob) => {
    const shot = { id: crypto.randomUUID(), blob, takenAt: new Date().toISOString() };
    setSending((n) => n + 1);
    try {
      if (!navigator.onLine) throw new NetworkError('Hors ligne');
      const state = await uploadShot(shot);
      if (!state) return toast('Photo refusée par le serveur', 'error');
      qc.setQueryData<PelliculeState>(['pellicule'], state);
      qc.invalidateQueries({ queryKey: ['unpack'] });
      setBump((b) => b + 1);
    } catch (e) {
      if (e instanceof NetworkError) {
        // Pas de réseau : la photo est gardée sur le téléphone et partira dès que possible.
        await enqueueShot(shot);
        setBump((b) => b + 1);
        toast('Pas de réseau : ta photo partira dès que possible');
      } else toast(errMsg(e), 'error');
    } finally {
      setSending((n) => n - 1);
    }
  };

  /** Photo prise par erreur : on la retire tant que c'est possible. */
  const undoLast = async (shotId: string) => {
    if (!(await confirmAction({ title: 'Annuler la dernière photo ?', message: 'Elle sera supprimée de ta Pellicule.', confirmLabel: 'Annuler la photo', destructive: true }))) return;
    try {
      qc.setQueryData<PelliculeState>(['pellicule'], await api<PelliculeState>(`/api/pellicule/shots/${shotId}`, { method: 'DELETE' }));
      qc.invalidateQueries({ queryKey: ['unpack'] });
      toast('Photo annulée');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const retryPending = async () => {
    const { sent, last } = await flushQueue();
    if (last) qc.setQueryData(['pellicule'], last);
    if (sent) qc.invalidateQueries({ queryKey: ['unpack'] });
    toast(sent ? `${sent} photo${sent > 1 ? 's' : ''} envoyée${sent > 1 ? 's' : ''}` : 'Toujours pas de réseau', sent ? 'ok' : 'error');
  };

  const shoot = async () => {
    setFlash(true);
    setTimeout(() => setFlash(false), 90);
    navigator.vibrate?.(20);
    const blob = await cam.capture();
    if (blob) send(blob);
  };

  const fallback = useFilePicker('image/*', (f) => send(f), 'environment');
  const total = pel?.mine.total ?? 0;
  const days = pel?.mine.days ?? [0, 0, 0, 0, 0, 0, 0];

  return (
    <div data-screen-label="Pellicule" className="flex animate-in flex-col gap-3.5">
      {fallback.input}
      <div className="phdark relative grid h-[min(64vh,640px)] place-items-center overflow-hidden rounded-[36px] shadow-deep">
        <video
          ref={cam.videoRef}
          muted
          playsInline
          autoPlay
          className={cx('absolute inset-0 h-full w-full object-cover transition-opacity duration-500', cam.state === 'live' ? 'opacity-100' : 'opacity-0')}
          style={{ transform: facing === 'user' ? 'scaleX(-1)' : undefined }}
        />
        {cam.state === 'starting' && <span className="font-mono text-xs text-steel">aperçu caméra</span>}
        {(cam.state === 'denied' || cam.state === 'unavailable') && (
          <div className="relative flex max-w-[300px] flex-col items-center gap-3 px-6 text-center text-white">
            <WarningCircle size={34} />
            <div className="text-[0.9375rem] leading-snug">
              {cam.state === 'denied' ? 'Autorise l’accès à la caméra pour remplir ta pellicule.' : 'Aucune caméra disponible sur cet appareil.'}
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {cam.state === 'denied' && (
                <button type="button" onClick={cam.retry} className="tap h-11 rounded-[22px] border-0 bg-white px-4 text-sm font-bold text-night">
                  Réessayer
                </button>
              )}
              <button type="button" onClick={fallback.open} className="tap flex h-11 items-center gap-2 rounded-[22px] border-0 bg-white/15 px-4 text-sm font-bold text-white">
                <ImageSquare size={18} /> Prendre avec l’appareil
              </button>
            </div>
          </div>
        )}
        {pel?.undo && new Date(pel.undo.until).getTime() > now && (
          <button
            type="button"
            onClick={() => void undoLast(pel.undo!.shotId)}
            className="tap absolute right-3.5 bottom-3.5 z-10 flex h-10 animate-pop items-center gap-2 rounded-[20px] border-0 bg-black/55 px-3.5 text-[0.8125rem] font-bold text-white tabular-nums backdrop-blur"
          >
            <ArrowCounterClockwise size={16} weight="bold" />
            Annuler la dernière photo · {(() => {
              const left = Math.max(0, Math.floor((new Date(pel.undo.until).getTime() - now) / 1000));
              return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
            })()}
          </button>
        )}
        {pel?.moment && momentLeft > 0 ? (
          <div className="absolute top-3.5 left-3.5 flex h-10 animate-pop items-center gap-2 rounded-[20px] bg-gradient-to-r from-ember to-heart px-3.5 text-[0.8125rem] font-extrabold text-white tabular-nums shadow-[0_8px_22px_rgba(229,72,77,.4)]">
            <Lightning size={16} weight="fill" />
            <span>
              Moment Mandrix · {Math.floor(momentLeft / 60)}:{String(momentLeft % 60).padStart(2, '0')}
            </span>
          </div>
        ) : (
          <div className="absolute top-3.5 left-3.5 flex h-10 items-center gap-2 rounded-[20px] bg-white/15 px-3.5 text-[0.8125rem] font-bold text-white tabular-nums backdrop-blur">
            <LockSimple size={16} weight="fill" />
            <span>{cd.line}</span>
          </div>
        )}
        <div className="absolute top-3.5 right-3.5 flex h-10 items-center gap-1.5 rounded-[20px] bg-white/15 px-3.5 text-[0.8125rem] font-bold text-white backdrop-blur">
          <Fire size={16} weight="fill" className="text-ember" />
          <span>{pel?.streak.weeks ?? 0} sem.</span>
        </div>
        <div className="pointer-events-none absolute inset-0 bg-white" style={{ opacity: flash ? 0.9 : 0, transition: flash ? 'opacity 0s' : 'opacity .6s ease-out' }} />
        <div className="absolute right-0 bottom-5 left-0 flex items-center justify-center gap-[30px]">
          <div key={bump} className={cx('relative grid h-14 w-14 place-items-center rounded-[18px] bg-white/15 text-white backdrop-blur', bump > 0 && 'animate-pop')}>
            <LockSimple size={22} weight="fill" />
            <span className="absolute -top-2 -right-2 grid h-6 min-w-6 place-items-center rounded-xl bg-brand px-1.5 text-xs font-extrabold text-white">{total + pending}</span>
          </div>
          <button
            type="button"
            aria-label="Prendre une photo"
            disabled={cam.state !== 'live'}
            onClick={shoot}
            className={cx('tap h-20 w-20 rounded-full border-[5px] border-white bg-transparent p-[5px] transition-transform duration-150 active:scale-[.88]', cam.state !== 'live' && 'opacity-50')}
          >
            <span className={cx('block h-full w-full rounded-full bg-white', sending > 0 && 'animate-breath')} />
          </button>
          <button
            type="button"
            aria-label="Changer de caméra"
            onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')}
            className="tap grid h-14 w-14 place-items-center rounded-full border-0 bg-white/15 text-white backdrop-blur transition-transform duration-500 ease-spring active:rotate-180"
          >
            <CameraRotate size={24} />
          </button>
        </div>
      </div>
      <div className="card flex flex-col gap-3 p-[18px]">
        <div className="flex flex-wrap items-end gap-3.5">
          <div className="mr-auto">
            <div className="text-[1.375rem] font-extrabold tracking-[-.02em]">
              {total} {total > 1 ? 'photos scellées' : 'photo scellée'}
            </div>
            <div className="text-[0.8125rem] text-mute">{pel?.weekLabel ?? ''}</div>
          </div>
          <div className="flex h-[58px] items-end gap-2">
            {DAYS.map((l, i) => {
              const c = days[i];
              return (
                <div key={i} className="flex h-full flex-col items-center justify-end gap-1">
                  <div
                    className={cx('w-4 rounded-lg transition-[height] duration-500 ease-spring', i === todayIdx ? 'bg-brand' : c ? 'bg-ink' : 'bg-line')}
                    style={{ height: Math.min(36, 6 + c * 6) }}
                  />
                  <span className={cx('text-xs font-bold', i === todayIdx ? 'text-acc' : 'text-mute')}>{l}</span>
                </div>
              );
            })}
          </div>
        </div>
        {pending > 0 && (
          <div className="flex items-center gap-2.5 rounded-[22px] bg-soft py-1.5 pr-1.5 pl-3.5 text-sm font-semibold">
            <CloudArrowUp size={20} className="flex-none text-acc" />
            <span className="flex-1">
              {pending} photo{pending > 1 ? 's' : ''} en attente d’envoi
            </span>
            <button type="button" onClick={retryPending} className="tap h-10 rounded-[20px] border-0 bg-ink px-3.5 text-[0.8125rem] font-bold text-inv active:scale-95">
              Réessayer
            </button>
          </div>
        )}
        <p className="m-0 text-sm leading-normal text-pretty text-mute">
          Tes photos restent cachées, même pour toi, jusqu’à dimanche 20h. Elles rejoignent la pellicule publique de Mandrix. Sans réseau, elles partent dès que la connexion revient.
        </p>
      </div>
      <button
        type="button"
        onClick={() => nav('/deballage')}
        className="tap flex h-14 items-center justify-center gap-2.5 rounded-[28px] border-0 bg-ink text-[0.9375rem] font-bold text-inv transition-transform active:scale-[.97]"
      >
        <span>Aller au déballage</span>
        <ArrowRight size={20} />
      </button>
    </div>
  );
}
