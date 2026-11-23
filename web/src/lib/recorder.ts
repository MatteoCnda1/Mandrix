import { useEffect, useRef, useState } from 'react';

// Enregistrement d'un message vocal avec MediaRecorder.
// Safari produit de l'AAC (audio/mp4), Chrome et Firefox de l'Opus (audio/webm, audio/ogg) :
// le serveur convertit tout en AAC pour que chacun puisse l'écouter.

export const VOICE_MAX_SECONDS = 300;

const TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

export function voiceSupported() {
  return typeof window !== 'undefined' && 'MediaRecorder' in window && !!navigator.mediaDevices?.getUserMedia;
}

export function useVoiceRecorder(onLimit: () => void) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const raf = useRef(0);
  const audioCtx = useRef<AudioContext | null>(null);
  const startedAt = useRef(0);
  const limit = useRef(onLimit);
  limit.current = onLimit;

  const cleanup = () => {
    clearInterval(timer.current);
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
    setRecording(false);
    setLevel(0);
  };

  useEffect(() => () => cleanup(), []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Démarre l'enregistrement ; lève une erreur lisible si le micro est refusé. */
  const start = async () => {
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      throw new Error((e as DOMException).name === 'NotAllowedError' ? 'Autorise le micro pour envoyer un vocal' : 'Micro indisponible sur cet appareil');
    }
    stream.current = s;
    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const r = new MediaRecorder(s, mimeType ? { mimeType } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.start(250);
    rec.current = r;
    startedAt.current = Date.now();
    setElapsed(0);
    setRecording(true);
    timer.current = setInterval(() => {
      const sec = Math.floor((Date.now() - startedAt.current) / 1000);
      setElapsed(sec);
      if (sec >= VOICE_MAX_SECONDS) limit.current();
    }, 250);

    // Niveau sonore pour l'animation pendant l'enregistrement.
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      audioCtx.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(s).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 64));
        raf.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* animation facultative */
    }
  };

  /** Arrête l'enregistrement et renvoie le fichier (null si annulé ou trop court). */
  const stop = (keep: boolean): Promise<Blob | null> =>
    new Promise((resolve) => {
      const r = rec.current;
      rec.current = null;
      if (!r || r.state === 'inactive') {
        cleanup();
        return resolve(null);
      }
      const duration = Date.now() - startedAt.current;
      r.onstop = () => {
        const type = r.mimeType || chunks.current[0]?.type || 'audio/webm';
        const blob = new Blob(chunks.current, { type });
        cleanup();
        resolve(keep && duration > 600 && blob.size > 0 ? blob : null);
      };
      r.stop();
    });

  return { recording, elapsed, level, start, stop };
}

export const voiceFileName = (blob: Blob) => (blob.type.includes('mp4') ? 'vocal.m4a' : blob.type.includes('ogg') ? 'vocal.ogg' : 'vocal.webm');
