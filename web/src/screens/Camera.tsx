import type { PelliculeState } from '@mandrix/shared';
import { ArrowRight, CameraRotate, Fire, ImageSquare, LockSimple, WarningCircle } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { cx, useFilePicker } from '../components/ui';
import { errMsg, upload } from '../lib/api';
import { qc, usePellicule } from '../lib/data';
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
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().catch(() => {});
        }
        setState('live');
      })
      .catch((e: DOMException) => setState(e.name === 'NotAllowedError' ? 'denied' : 'unavailable'));
    return () => {
      cancelled = true;
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

  const send = async (blob: Blob) => {
    setSending((n) => n + 1);
    try {
      const state = await upload<PelliculeState>('/api/pellicule/shots', blob, 'pellicule.jpg');
      qc.setQueryData(['pellicule'], state);
      qc.invalidateQueries({ queryKey: ['unpack'] });
      setBump((b) => b + 1);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setSending((n) => n - 1);
    }
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
            <div className="text-[15px] leading-snug">
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
        <div className="absolute top-3.5 left-3.5 flex h-10 items-center gap-2 rounded-[20px] bg-white/15 px-3.5 text-[13px] font-bold text-white tabular-nums backdrop-blur">
          <LockSimple size={16} weight="fill" />
          <span>{cd.line}</span>
        </div>
        <div className="absolute top-3.5 right-3.5 flex h-10 items-center gap-1.5 rounded-[20px] bg-white/15 px-3.5 text-[13px] font-bold text-white backdrop-blur">
          <Fire size={16} weight="fill" className="text-ember" />
          <span>{pel?.streak.weeks ?? 0} sem.</span>
        </div>
        <div className="pointer-events-none absolute inset-0 bg-white" style={{ opacity: flash ? 0.9 : 0, transition: flash ? 'opacity 0s' : 'opacity .6s ease-out' }} />
        <div className="absolute right-0 bottom-5 left-0 flex items-center justify-center gap-[30px]">
          <div key={bump} className={cx('relative grid h-14 w-14 place-items-center rounded-[18px] bg-white/15 text-white backdrop-blur', bump > 0 && 'animate-pop')}>
            <LockSimple size={22} weight="fill" />
            <span className="absolute -top-2 -right-2 grid h-6 min-w-6 place-items-center rounded-xl bg-brand px-1.5 text-xs font-extrabold text-white">{total}</span>
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
            <div className="text-[22px] font-extrabold tracking-[-.02em]">
              {total} {total > 1 ? 'photos scellées' : 'photo scellée'}
            </div>
            <div className="text-[13px] text-mute">{pel?.weekLabel ?? ''}</div>
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
        <p className="m-0 text-sm leading-normal text-pretty text-mute">
          Tes photos restent cachées, même pour toi, jusqu’à dimanche 20h. Elles rejoignent la pellicule publique de Mandrix.
        </p>
      </div>
      <button
        type="button"
        onClick={() => nav('/deballage')}
        className="tap flex h-14 items-center justify-center gap-2.5 rounded-[28px] border-0 bg-ink text-[15px] font-bold text-inv transition-transform active:scale-[.97]"
      >
        <span>Aller au déballage</span>
        <ArrowRight size={20} />
      </button>
    </div>
  );
}
