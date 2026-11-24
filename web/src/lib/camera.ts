import { useCallback, useEffect, useRef, useState } from 'react';

// Caméra du téléphone (Pellicule, stories) : flux vidéo en direct et capture en JPEG.

export type CamState = 'starting' | 'live' | 'denied' | 'unavailable';

export function useCamera(facing: 'user' | 'environment') {
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
