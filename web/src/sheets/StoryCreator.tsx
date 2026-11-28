import { ArrowCounterClockwise, ArrowLeft, CameraRotate, CornersIn, CornersOut, Eye, ImageSquare, MusicNotes, PaperPlaneTilt, PencilSimple, SpeakerHigh, SpeakerSlash, WarningCircle, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { MusicPicker, previewUrl as musicPreviewUrl, type PickedMusic } from '../components/MusicPicker';
import { Avatar, Portal, cx, useFilePicker } from '../components/ui';
import { api, errMsg, upload } from '../lib/api';
import { useCamera } from '../lib/camera';
import { isAnimated } from '../lib/image';
import { checkVideoLength } from '../lib/videoCheck';
import { qc, useConfig, useMe } from '../lib/data';
import { useObjectUrl } from '../lib/hooks';
import { useScrollLock } from '../lib/scrollLock';
import { clampView, decodeImage, placement, renderStory, sizeOf, type Size, type StoryFit, type StoryView } from '../lib/storyImage';
import { toast, useUI } from '../lib/store';

// Nouvelle story (#92) : appareil photo en plein écran, recadrage dans le format 9:16, aperçu, publication.

/** « animated » : GIF ou image animée, envoyée telle quelle (le recadrage par canvas la figerait). */
type Picked = { blob: Blob; kind: 'image' | 'video' | 'animated' };
const close = () => useUI.setState({ composer: null });
const RESET: StoryView = { zoom: 1, x: 0, y: 0 };

/** Bouton rond translucide des barres du haut et du bas. */
function RoundBtn({ label, onClick, children, disabled, className }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx('tap grid h-11 w-11 flex-none place-items-center rounded-full border-0 bg-white/15 text-white backdrop-blur active:scale-90 disabled:opacity-40', className)}
    >
      {children}
    </button>
  );
}

/** Taille du cadre 9:16 qui tient dans la zone disponible (420 px de large au plus, comme la visionneuse). */
function useFrame() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [frame, setFrame] = useState<Size | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.floor(Math.min(r.width, (r.height * 9) / 16, 420));
      setFrame(w > 0 ? { w, h: Math.round((w * 16) / 9) } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, frame };
}

function CameraStep({ onPicked }: { onPicked: (p: Picked) => void }) {
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const cam = useCamera(facing);
  const { data: config } = useConfig();
  const maxMb = config?.maxUploadMb ?? 100;
  const accept = async (f: File) => {
    if (f.size > maxMb * 1024 * 1024) return toast(`Fichier trop volumineux (max ${maxMb} Mo)`, 'error');
    if (!(await checkVideoLength(f, 'story'))) return;
    onPicked({ blob: f, kind: f.type.startsWith('video/') ? 'video' : (await isAnimated(f)) ? 'animated' : 'image' });
  };
  const gallery = useFilePicker('image/*,video/mp4,video/webm,video/quicktime', accept);
  // Caméra refusée ou absente : l'appareil photo du téléphone, par le sélecteur de fichiers.
  const native = useFilePicker('image/*', accept, 'environment');
  const [flash, setFlash] = useState(false);

  const shoot = async () => {
    const blob = await cam.capture();
    if (!blob) return toast('La caméra n’est pas encore prête', 'error');
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    onPicked({ blob, kind: 'image' });
  };

  return (
    <>
      {gallery.input}
      {native.input}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video
          ref={cam.videoRef}
          playsInline
          muted
          autoPlay
          className="absolute inset-0 h-full w-full object-cover"
          style={{ transform: facing === 'user' ? 'scaleX(-1)' : undefined }}
          aria-label="Aperçu de la caméra"
        />
        {flash && <div className="absolute inset-0 bg-white/80" />}
        {(cam.state === 'denied' || cam.state === 'unavailable') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <WarningCircle size={40} weight="fill" className="text-white/80" />
            <div className="text-lg font-bold">{cam.state === 'denied' ? 'Accès à la caméra refusé' : 'Caméra indisponible ici'}</div>
            <p className="m-0 text-sm text-white/75">
              {cam.state === 'denied' ? 'Autorise la caméra dans les réglages du téléphone, ou utilise l’appareil photo ou la galerie.' : 'Utilise l’appareil photo du téléphone ou ta galerie.'}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" onClick={native.open} className="tap h-11 rounded-full border-0 bg-white px-4 text-sm font-bold text-black">
                Appareil photo
              </button>
              <button type="button" onClick={gallery.open} className="tap h-11 rounded-full border-0 bg-white/15 px-4 text-sm font-bold text-white">
                Galerie
              </button>
              {cam.state === 'denied' && (
                <button type="button" onClick={cam.retry} className="tap h-11 rounded-full border-0 bg-white/15 px-4 text-sm font-bold text-white">
                  Réessayer
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-none items-center justify-between px-8 pt-4" style={{ paddingBottom: 'calc(22px + env(safe-area-inset-bottom))' }}>
        <RoundBtn label="Choisir dans la galerie" onClick={gallery.open} className="h-12 w-12">
          <ImageSquare size={24} />
        </RoundBtn>
        <button
          type="button"
          aria-label="Prendre la photo"
          disabled={cam.state !== 'live'}
          onClick={shoot}
          className="tap grid h-[78px] w-[78px] place-items-center rounded-full border-[5px] border-solid border-white bg-transparent p-0 transition-transform active:scale-90 disabled:opacity-40"
        >
          <span className="h-[60px] w-[60px] rounded-full bg-white" />
        </button>
        <RoundBtn label="Changer de caméra" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} disabled={cam.state === 'denied' || cam.state === 'unavailable'} className="h-12 w-12">
          <CameraRotate size={24} />
        </RoundBtn>
      </div>
    </>
  );
}

type Pt = { x: number; y: number };
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Photo : recadrage (glisser, pincer, molette), Remplir / Ajuster, aperçu puis publication. */
/** Musique choisie, en surimpression du cadre : pochette, titre, artiste ; toucher pour modifier, ✕ pour retirer. */
function MusicChip({ music, onEdit, onRemove }: { music: PickedMusic; onEdit?: () => void; onRemove?: () => void }) {
  return (
    <div className="absolute top-14 left-1/2 z-10 flex max-w-[85%] -translate-x-1/2 items-center gap-2 rounded-full bg-black/55 py-1 pr-1 pl-1 text-white backdrop-blur">
      <button type="button" onClick={onEdit} disabled={!onEdit} className="tap relative flex min-w-0 items-center gap-2 border-0 bg-transparent p-0 text-left text-white after:absolute after:-inset-y-1.5 after:-left-1 after:right-0 after:content-['']" aria-label={`Musique : ${music.track.title}, ${music.track.artist}. Modifier`}>
        {music.track.cover ? <img src={music.track.cover} alt="" className="h-8 w-8 flex-none rounded-full object-cover" /> : <MusicNotes size={18} className="ml-1.5 flex-none" />}
        <span className="min-w-0 truncate text-[0.8125rem] font-bold">
          {music.track.title} <span className="font-semibold text-white/70">· {music.track.artist}</span>
        </span>
      </button>
      {onRemove && (
        <button type="button" aria-label="Retirer la musique" onClick={onRemove} className="tap relative grid h-8 w-8 flex-none place-items-center rounded-full border-0 bg-white/15 text-white after:absolute after:-inset-1.5 after:content-['']">
          <X size={14} weight="bold" />
        </button>
      )}
    </div>
  );
}

function PhotoStep({ blob, onBack }: { blob: Blob; onBack: () => void }) {
  const { data: me } = useMe();
  const { data: config } = useConfig();
  // Musique (#104) : titre et passage choisis dans la bibliothèque Plex.
  const [music, setMusic] = useState<PickedMusic | null>(null);
  const [picking, setPicking] = useState(false);
  const url = useObjectUrl(blob);
  const { ref, frame } = useFrame();
  const [img, setImg] = useState<ImageBitmap | HTMLImageElement | null>(null);
  const [fit, setFit] = useState<StoryFit>('fill');
  const [view, setView] = useState<StoryView>(RESET);
  const [live, setLive] = useState(false);
  const [preview, setPreview] = useState<Blob | null>(null);
  const previewUrl = useObjectUrl(preview);
  const [progress, setProgress] = useState<number | null>(null);
  const pointers = useRef(new Map<number, Pt>());
  const g = useRef<{ start: StoryView; p0: Pt; d0?: number; m0?: Pt } | null>(null);
  const lastTap = useRef(0);

  useEffect(() => {
    let alive = true;
    decodeImage(blob)
      .then((i) => alive && setImg(i))
      .catch(() => toast('Photo illisible sur cet appareil', 'error'));
    return () => {
      alive = false;
    };
  }, [blob]);

  const size = img ? sizeOf(img) : null;
  const clamp = (v: StoryView, f = fit) => (size && frame ? clampView(v, size, frame, f) : v);

  const down = (e: React.PointerEvent) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointeur déjà relâché */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setLive(true);
    const pts = [...pointers.current.values()];
    if (pts.length >= 2) g.current = { start: view, p0: pts[0], d0: dist(pts[0], pts[1]), m0: mid(pts[0], pts[1]) };
    else {
      g.current = { start: view, p0: pts[0] };
      // Double tap : retour au cadrage de départ.
      if (Date.now() - lastTap.current < 300) setView(RESET);
      lastTap.current = Date.now();
    }
  };
  const move = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !g.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const s = g.current;
    if (pts.length >= 2 && s.d0 && s.m0) {
      const m = mid(pts[0], pts[1]);
      setView(clamp({ zoom: (s.start.zoom * dist(pts[0], pts[1])) / s.d0, x: s.start.x + m.x - s.m0.x, y: s.start.y + m.y - s.m0.y }));
    } else {
      setView(clamp({ zoom: s.start.zoom, x: s.start.x + e.clientX - s.p0.x, y: s.start.y + e.clientY - s.p0.y }));
    }
  };
  const up = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const rest = [...pointers.current.values()];
    if (rest.length) g.current = { start: view, p0: rest[0] };
    else {
      g.current = null;
      setLive(false);
    }
  };
  const wheel = (e: React.WheelEvent) => setView(clamp({ ...view, zoom: view.zoom * Math.exp(-e.deltaY * 0.002) }));

  const switchFit = () => {
    const next = fit === 'fill' ? 'fit' : 'fill';
    setFit(next);
    setView(RESET);
  };

  const render = async () => {
    if (!img || !frame) throw new Error('Photo pas encore prête');
    return renderStory(img, frame, fit, clamp(view));
  };

  const showPreview = async () => {
    try {
      setPreview(await render());
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const publish = async () => {
    if (progress !== null) return;
    setProgress(0);
    try {
      const out = preview ?? (await render());
      await publishStory(out, 'story.jpg', setProgress, music);
    } catch (e) {
      toast(errMsg(e), 'error');
      setProgress(null);
    }
  };

  const p = size && frame ? placement(size, frame, fit, view) : null;
  const imgStyle = (extra?: CSSProperties): CSSProperties | undefined =>
    p ? { position: 'absolute', left: p.left, top: p.top, width: p.width, height: p.height, maxWidth: 'none', transition: live ? 'none' : 'all .2s ease', ...extra } : undefined;

  return (
    <>
      <div className="flex flex-none items-center gap-2 px-4" style={{ paddingTop: 'calc(10px + env(safe-area-inset-top))' }}>
        <RoundBtn label={preview ? 'Retour au recadrage' : 'Reprendre une photo'} onClick={() => (preview ? setPreview(null) : onBack())}>
          <ArrowLeft size={20} weight="bold" />
        </RoundBtn>
        <div className="flex-1 text-center text-[0.9375rem] font-bold">{preview ? 'Aperçu' : 'Recadrer'}</div>
        <RoundBtn label="Fermer" onClick={close}>
          <X size={20} weight="bold" />
        </RoundBtn>
      </div>
      <div ref={ref} className="grid min-h-0 flex-1 place-items-center px-3 py-3">
        {frame && (
          <div className="relative overflow-hidden rounded-[28px] bg-[#0b0f14]" style={{ width: frame.w, height: frame.h }}>
            {preview && previewUrl ? (
              <>
                <img src={previewUrl} alt="Aperçu de ta story" className="absolute inset-0 h-full w-full object-cover" />
                {music && (
                  <>
                    <audio src={musicPreviewUrl(music)} autoPlay loop />
                    <MusicChip music={music} />
                  </>
                )}
                {/* Comme dans la visionneuse : barre de progression et auteur. */}
                <div className="absolute top-3.5 right-[18px] left-[18px] h-[3px] rounded-full bg-white/40">
                  <div className="h-full w-1/3 rounded-full bg-white" />
                </div>
                {me && (
                  <div className="absolute top-7 left-[18px] flex items-center gap-2 text-sm font-bold drop-shadow">
                    <Avatar user={me} size={32} /> {me.displayName.split(' ')[0]} <span className="font-semibold text-white/75">à l’instant</span>
                  </div>
                )}
              </>
            ) : (
              <div
                className="absolute inset-0 touch-none select-none"
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
                onWheel={wheel}
                role="img"
                aria-label="Glisse pour déplacer, pince pour zoomer, touche deux fois pour recadrer à nouveau"
              >
                {url && p && fit === 'fit' && (
                  <img src={url} alt="" draggable={false} className="absolute inset-0 h-full w-full scale-110 object-cover opacity-70 blur-2xl" />
                )}
                {url && p && <img src={url} alt="" draggable={false} style={imgStyle()} />}
                {/* Repères du tiers pendant le geste. */}
                {live && (
                  <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                    {Array.from({ length: 9 }, (_, i) => (
                      <span key={i} className="border border-solid border-white/20" />
                    ))}
                  </div>
                )}
              </div>
            )}
            {!preview && music && <MusicChip music={music} onEdit={() => setPicking(true)} onRemove={() => setMusic(null)} />}
            {progress !== null && <UploadOverlay progress={progress} />}
          </div>
        )}
      </div>
      {picking && (
        <MusicPicker
          initial={music}
          onClose={() => setPicking(false)}
          onPick={(m) => {
            setMusic(m);
            setPicking(false);
          }}
        />
      )}
      {/* `flex-wrap` : sur un écran étroit, « Publier » passe à la ligne au lieu de sortir de l'écran. */}
      <div className="flex flex-none flex-wrap items-center justify-center gap-2.5 px-4 pt-1" style={{ paddingBottom: 'calc(18px + env(safe-area-inset-bottom))' }}>
        {preview ? (
          <button type="button" onClick={() => setPreview(null)} className="tap flex h-12 items-center gap-2 rounded-full border-0 bg-white/15 px-4 text-sm font-bold text-white">
            <PencilSimple size={18} /> Modifier
          </button>
        ) : (
          <>
            <RoundBtn label={fit === 'fill' ? 'Ajuster : photo entière' : 'Remplir le cadre'} onClick={switchFit}>
              {fit === 'fill' ? <CornersIn size={20} weight="bold" /> : <CornersOut size={20} weight="bold" />}
            </RoundBtn>
            <RoundBtn label="Recadrer à nouveau" onClick={() => setView(RESET)} disabled={view.zoom === 1 && view.x === 0 && view.y === 0}>
              <ArrowCounterClockwise size={20} weight="bold" />
            </RoundBtn>
            {config?.music && (
              <RoundBtn label={music ? 'Changer la musique' : 'Ajouter une musique'} onClick={() => setPicking(true)} className={music ? 'bg-white text-black' : undefined}>
                <MusicNotes size={20} weight={music ? 'fill' : 'regular'} />
              </RoundBtn>
            )}
            <RoundBtn label="Aperçu" onClick={showPreview} disabled={!img}>
              <Eye size={20} weight="bold" />
            </RoundBtn>
          </>
        )}
        <button type="button" onClick={publish} disabled={!img || progress !== null} className="tap flex h-12 items-center gap-2 rounded-full border-0 bg-white px-5 text-sm font-extrabold text-black disabled:opacity-50">
          <PaperPlaneTilt size={18} weight="fill" /> Publier
        </button>
      </div>
    </>
  );
}

/** Vidéo ou GIF : aperçu dans le cadre de la story, puis publication telle quelle (conversion côté serveur). */
function MediaStep({ blob, animated, onBack }: { blob: Blob; animated: boolean; onBack: () => void }) {
  const url = useObjectUrl(blob);
  const { ref, frame } = useFrame();
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const publish = async () => {
    if (progress !== null) return;
    setProgress(0);
    try {
      await publishStory(blob, blob instanceof File ? blob.name : animated ? 'story.gif' : 'story.mp4', setProgress);
    } catch (e) {
      toast(errMsg(e), 'error');
      setProgress(null);
    }
  };
  return (
    <>
      <div className="flex flex-none items-center gap-2 px-4" style={{ paddingTop: 'calc(10px + env(safe-area-inset-top))' }}>
        <RoundBtn label="Choisir autre chose" onClick={onBack}>
          <ArrowLeft size={20} weight="bold" />
        </RoundBtn>
        <div className="flex-1 text-center text-[0.9375rem] font-bold">Aperçu</div>
        <RoundBtn label="Fermer" onClick={close}>
          <X size={20} weight="bold" />
        </RoundBtn>
      </div>
      <div ref={ref} className="grid min-h-0 flex-1 place-items-center px-3 py-3">
        {frame && url && (
          <div className="relative overflow-hidden rounded-[28px] bg-[#0b0f14]" style={{ width: frame.w, height: frame.h }}>
            {animated ? (
              <img src={url} alt="Aperçu de ta story animée" className="absolute inset-0 h-full w-full object-contain" />
            ) : (
              <video src={url} autoPlay loop playsInline muted={muted} className="absolute inset-0 h-full w-full object-contain" />
            )}
            {progress !== null && <UploadOverlay progress={progress} />}
          </div>
        )}
      </div>
      <div className="flex flex-none items-center justify-center gap-2.5 px-4 pt-1" style={{ paddingBottom: 'calc(18px + env(safe-area-inset-bottom))' }}>
        {!animated && (
          <RoundBtn label={muted ? 'Activer le son' : 'Couper le son'} onClick={() => setMuted(!muted)}>
            {muted ? <SpeakerSlash size={20} /> : <SpeakerHigh size={20} />}
          </RoundBtn>
        )}
        <button type="button" onClick={publish} disabled={progress !== null} className="tap flex h-12 items-center gap-2 rounded-full border-0 bg-white px-5 text-sm font-extrabold text-black disabled:opacity-50">
          <PaperPlaneTilt size={18} weight="fill" /> Publier
        </button>
      </div>
    </>
  );
}

function UploadOverlay({ progress }: { progress: number }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-black/55" aria-live="polite">
      <div className="flex flex-col items-center gap-3 text-sm font-bold">
        <div className="h-1.5 w-40 overflow-hidden rounded-full bg-white/25">
          <div className="h-full rounded-full bg-white transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        {progress < 1 ? `Envoi… ${Math.round(progress * 100)} %` : 'Publication…'}
      </div>
    </div>
  );
}

async function publishStory(blob: Blob, name: string, onProgress: (p: number) => void, music?: PickedMusic | null) {
  const m = await upload<{ id: string }>('/api/media', blob, name, onProgress);
  onProgress(1);
  // Avec une musique, le serveur découpe aussi le passage (quelques secondes).
  await api('/api/stories', { body: { mediaId: m.id, music: music ? { trackId: music.trackId, start: music.start, duration: music.duration } : undefined } });
  qc.invalidateQueries({ queryKey: ['stories'] });
  toast('Story publiée, visible 24 heures');
  close();
}

export function StoryCreator() {
  const [picked, setPicked] = useState<Picked | null>(null);
  useScrollLock();
  useEffect(() => {
    // Le choix de musique (ou une confirmation) par-dessus gère Échap lui-même : la photo n'est pas perdue.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[data-music-picker], [role="alertdialog"]') && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <Portal>
      <div className="fixed inset-x-0 z-[55] flex flex-col bg-black text-white" style={{ top: 'var(--vv-top, 0px)', height: 'var(--vvh, 100dvh)' }} role="dialog" aria-modal="true" aria-label="Nouvelle story">
        {!picked && (
          <>
            <div className="absolute top-0 right-0 left-0 z-10 flex items-center justify-between px-4" style={{ paddingTop: 'calc(10px + env(safe-area-inset-top))' }}>
              <span className="rounded-full bg-black/35 px-3 py-1.5 text-[0.8125rem] font-bold backdrop-blur">Nouvelle story · 24 h</span>
              <RoundBtn label="Fermer" onClick={close}>
                <X size={20} weight="bold" />
              </RoundBtn>
            </div>
            <CameraStep onPicked={setPicked} />
          </>
        )}
        {picked?.kind === 'image' && <PhotoStep blob={picked.blob} onBack={() => setPicked(null)} />}
        {(picked?.kind === 'video' || picked?.kind === 'animated') && <MediaStep blob={picked.blob} animated={picked.kind === 'animated'} onBack={() => setPicked(null)} />}
      </div>
    </Portal>
  );
}
