import { POLL_DURATIONS, POLL_MAX_OPTIONS, type MediaRef, type PollKind, type Post } from '@mandrix/shared';
import { Eye, Image as ImageIcon, Plus, Sticker, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { MentionSuggestions } from '../components/RichText';
import { Seg, Sheet, Switch, cx, useFilePicker } from '../components/ui';
import { api, errMsg, upload } from '../lib/api';
import { qc, useConfig } from '../lib/data';
import { useObjectUrl } from '../lib/hooks';
import { toast, useUI } from '../lib/store';

const close = () => useUI.setState({ composer: null });

function DropZone({ file, accept, label, onPick, onClear, aspect = '16 / 9' }: { file: File | null; accept: string; label: string; onPick: (f: File) => void; onClear?: () => void; aspect?: string }) {
  const url = useObjectUrl(file);
  const { input, open } = useFilePicker(accept, onPick);
  const isVideo = file?.type.startsWith('video/');
  return (
    <div className="relative">
      {input}
      <button
        type="button"
        onClick={open}
        className={cx(
          'tap grid w-full place-items-center overflow-hidden rounded-3xl p-0 font-mono text-xs text-phink transition-colors duration-300',
          file ? (isVideo ? 'phdark border-0' : 'ph border-0') : 'border-2 border-dashed border-line bg-soft',
        )}
        style={{ aspectRatio: aspect }}
      >
        {url && file ? (
          isVideo ? (
            <video src={url} muted autoPlay loop playsInline className="h-full w-full object-cover" />
          ) : (
            <img src={url} alt="" className="h-full w-full object-cover" />
          )
        ) : (
          <span className="flex flex-col items-center gap-2">
            <ImageIcon size={26} />
            {label}
          </span>
        )}
      </button>
      {file && onClear && (
        <button
          type="button"
          aria-label="Retirer"
          onClick={onClear}
          className="tap absolute top-2.5 right-2.5 grid h-11 w-11 place-items-center rounded-full border-0 bg-card text-ink shadow-pill"
        >
          <X size={18} />
        </button>
      )}
    </div>
  );
}

/** Photos d'un post : la première en grand, les suivantes en vignettes (carrousel, 10 au plus). */
function PhotoPicker({ photos, onAdd, onRemove }: { photos: File[]; onAdd: (f: File) => void; onRemove: (i: number) => void }) {
  const { input, open } = useFilePicker('image/*', onAdd, undefined, true);
  const first = useObjectUrl(photos[0] ?? null);
  return (
    <div className="flex flex-col gap-2">
      {input}
      <button
        type="button"
        onClick={open}
        className={cx(
          'tap relative grid w-full place-items-center overflow-hidden rounded-3xl p-0 font-mono text-xs text-phink',
          photos.length ? 'ph border-0' : 'border-2 border-dashed border-line bg-soft',
        )}
        style={{ aspectRatio: '16 / 9' }}
      >
        {first ? (
          <img src={first} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-2">
            <ImageIcon size={26} />
            Touche pour ajouter des photos (10 max)
          </span>
        )}
        {photos.length > 1 && <span className="absolute top-2.5 left-2.5 rounded-full bg-black/55 px-2.5 py-1 font-sans text-xs font-bold text-white">1/{photos.length}</span>}
      </button>
      {photos.length > 0 && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          {photos.map((f, i) => (
            <Thumb key={`${f.name}-${f.size}-${i}`} file={f} onRemove={() => onRemove(i)} />
          ))}
          {photos.length < 10 && (
            <button
              type="button"
              onClick={open}
              aria-label="Ajouter des photos"
              className="tap grid h-16 w-16 flex-none place-items-center rounded-[16px] border-2 border-dashed border-line bg-soft text-mute"
            >
              <Plus size={20} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Thumb({ file, onRemove }: { file: File; onRemove: () => void }) {
  const url = useObjectUrl(file);
  return (
    <div className="relative h-16 w-16 flex-none overflow-hidden rounded-[16px] bg-soft">
      {url && <img src={url} alt="" className="h-full w-full object-cover" />}
      <button type="button" aria-label="Retirer la photo" onClick={onRemove} className="tap absolute top-0.5 right-0.5 grid h-6 w-6 place-items-center rounded-full border-0 bg-black/60 text-white">
        <X size={12} weight="bold" />
      </button>
    </div>
  );
}

// Deux brouillons distincts : la légende (photo, vidéo) et le sondage. Publier l'un n'efface pas l'autre.
interface PollDraft {
  q: string;
  opts: string[];
  pollKind: PollKind;
  duration: number | null;
  isPublic: boolean;
}
const CAPTION_KEY = 'mandrix.draft.post';
const POLL_KEY = 'mandrix.draft.poll';
function load<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}
function save(key: string, value: unknown) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {
    /* stockage indisponible */
  }
}

export function Composer({ mode, initialKind, initialPool }: { mode: 'post' | 'story'; initialKind?: 0 | 1 | 2; initialPool?: boolean }) {
  const { data: config } = useConfig();
  const [kind, setKind] = useState<0 | 1 | 2>(() => initialKind ?? (mode === 'post' && load<PollDraft>(POLL_KEY)?.q && !load<string>(CAPTION_KEY) ? 2 : 0));
  const [file, setFile] = useState<File | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  // Brouillon gardé si l'on ferme la feuille par erreur (texte et sondage ; les fichiers ne sont pas gardés).
  // La légende n'est restaurée que pour une publication ouverte « à vide » (pas depuis le jeu ou les Reels).
  const keepsCaption = mode === 'post' && initialKind === undefined;
  const caption = keepsCaption ? load<string>(CAPTION_KEY) : null;
  const poll = mode === 'post' ? load<PollDraft>(POLL_KEY) : null;
  const [text, setText] = useState(caption ?? '');
  const [pool, setPool] = useState(!!initialPool);
  const [pollKind, setPollKind] = useState<PollKind>(poll?.pollKind ?? 'text');
  const [q, setQ] = useState(poll?.q ?? '');
  const [opts, setOpts] = useState(poll?.opts ?? ['', '', '']);
  const [duration, setDuration] = useState<number | null>(poll ? poll.duration : 24);
  const [isPublic, setIsPublic] = useState(poll?.isPublic ?? false);
  useEffect(() => {
    // Ouverte depuis le jeu ou les Reels : on ne touche pas au brouillon gardé.
    if (keepsCaption) save(CAPTION_KEY, text.trim() ? text : null);
  }, [keepsCaption, text]);
  useEffect(() => {
    if (mode !== 'post') return;
    const empty = !q.trim() && opts.every((o) => !o.trim());
    save(POLL_KEY, empty ? null : { q, opts, pollKind, duration, isPublic });
  }, [mode, q, opts, pollKind, duration, isPublic]);
  const textRef = useRef<HTMLInputElement | null>(null);
  const qRef = useRef<HTMLInputElement | null>(null);
  const [imgOpts, setImgOpts] = useState<(File | null)[]>([null, null]);
  const [progress, setProgress] = useState<number | null>(null);

  const maxMb = config?.maxUploadMb ?? 100;
  const pick = (f: File) => {
    if (f.size > maxMb * 1024 * 1024) return toast(`Fichier trop volumineux (max ${maxMb} Mo)`, 'error');
    setFile(f);
  };

  const labels = opts.map((o) => o.trim()).filter(Boolean);
  const valid =
    mode === 'story'
      ? !!file
      : kind === 0
        ? photos.length > 0
        : kind === 1
          ? !!file
          : !!q.trim() && (pollKind === 'text' ? labels.length >= 2 : pollKind === 'image' ? imgOpts.every(Boolean) : true);

  const busy = progress !== null;

  const uploadOne = async (f: File, base = 0, share = 1) =>
    upload<MediaRef>('/api/media', f, f.name || 'media', (p) => setProgress(base + p * share));

  const publish = async () => {
    if (!valid || busy) return;
    setProgress(0);
    try {
      if (mode === 'story') {
        const m = await uploadOne(file!);
        await api('/api/stories', { body: { mediaId: m.id } });
        qc.invalidateQueries({ queryKey: ['stories'] });
        toast('Story publiée');
      } else if (kind === 0) {
        // Carrousel : envoi des photos une à une, la progression couvre l'ensemble.
        const ids: string[] = [];
        for (const [i, f] of photos.entries()) ids.push((await uploadOne(f, i / photos.length, 1 / photos.length)).id);
        await api<Post>('/api/posts', {
          body: { kind: 'photo', mediaId: ids[0], extraMediaIds: ids.slice(1), text: text.trim(), pool: pool ? 'public' : null },
        });
        toast(photos.length > 1 ? `Post publié (${photos.length} photos)` : 'Post publié');
      } else if (kind === 1) {
        const m = await uploadOne(file!);
        await api<Post>('/api/posts', {
          body: { kind: 'video', mediaId: m.id, text: text.trim(), pool: pool ? 'public' : null },
        });
        toast('Post publié');
      } else {
        let options: { label: string; mediaId?: string }[] = [];
        if (pollKind === 'text') options = labels.map((label) => ({ label }));
        if (pollKind === 'image') {
          const a = await uploadOne(imgOpts[0]!, 0, 0.5);
          const b = await uploadOne(imgOpts[1]!, 0.5, 0.5);
          options = [
            { label: opts[0].trim() || 'Option 1', mediaId: a.id },
            { label: opts[1].trim() || 'Option 2', mediaId: b.id },
          ];
        }
        await api<Post>('/api/posts', { body: { kind: 'poll', pollKind, text: q.trim(), options, durationHours: duration, isPublic } });
        toast('Sondage publié');
      }
      if (mode === 'post') {
        for (const k of [['feed'], ['reels'], ['user-posts'], ['pool-stats']]) qc.invalidateQueries({ queryKey: k });
        // On reste sur l'écran d'où l'on publiait (jeu, profil…) ; sur le fil, on remonte voir le post.
        if (window.location.pathname === '/') window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      if (kind === 2) save(POLL_KEY, null);
      else if (keepsCaption) save(CAPTION_KEY, null);
      close();
    } catch (e) {
      toast(errMsg(e), 'error');
      setProgress(null);
    }
  };

  const pubLabel = busy ? (progress! < 1 ? `Envoi… ${Math.round(progress! * 100)} %` : 'Publication…') : 'Publier';

  return (
    <Sheet
      title={mode === 'story' ? 'Nouvelle story' : 'Nouveau post'}
      onClose={close}
      locked={busy}
      onLockedClose={() => toast('Envoi en cours, encore quelques secondes…')}
    >
      {mode === 'story' ? (
        <>
          <DropZone file={file} accept="image/*,video/*" label="Touche pour ajouter une photo ou une vidéo" onPick={pick} onClear={() => setFile(null)} aspect="4 / 5" />
          <p className="m-0 px-1 text-[0.8125rem] text-mute">Visible par tes amis pendant 24 heures.</p>
        </>
      ) : (
        <>
          <Seg
            value={kind}
            onChange={(k) => {
              setKind(k);
              setFile(null);
            }}
            options={[
              { value: 0 as const, label: 'Photo' },
              { value: 1 as const, label: 'Vidéo' },
              { value: 2 as const, label: 'Sondage' },
            ]}
          />
          {kind < 2 ? (
            <>
              {kind === 0 ? (
                <PhotoPicker
                  photos={photos}
                  onAdd={(f) => {
                    if (f.size > maxMb * 1024 * 1024) return toast(`Photo trop volumineuse (max ${maxMb} Mo)`, 'error');
                    setPhotos((p) => (p.length < 10 ? [...p, f] : p));
                  }}
                  onRemove={(i) => setPhotos((p) => p.filter((_, j) => j !== i))}
                />
              ) : (
                <DropZone
                  key={kind}
                  file={file}
                  accept="video/mp4,video/webm,video/quicktime"
                  label="Touche pour ajouter une vidéo"
                  onPick={pick}
                  onClear={() => setFile(null)}
                />
              )}
              <input
                ref={textRef}
                className="field"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={140}
                placeholder="Ajoute une légende, @mentionne un ami, #hashtag…"
              />
              <MentionSuggestions value={text} onChange={setText} inputRef={textRef} className="-mt-1" />
              <button
                type="button"
                onClick={() => setPool(!pool)}
                className="tap flex min-h-14 items-center gap-3 rounded-[28px] border-0 bg-soft px-3.5 py-2 text-left text-sm font-semibold text-ink"
              >
                <Sticker size={22} />
                <span className="flex-1">Envoyer aussi dans le pool Make It Friends</span>
                <Switch on={pool} />
              </button>
            </>
          ) : (
            <>
              <Seg
                size="sm"
                value={pollKind}
                onChange={setPollKind}
                options={[
                  { value: 'text' as const, label: 'Choix' },
                  { value: 'image' as const, label: 'Photos' },
                  { value: 'slider' as const, label: 'Curseur' },
                ]}
              />
              <input ref={qRef} className="field font-bold" value={q} onChange={(e) => setQ(e.target.value)} maxLength={90} placeholder="Ta question" />
              <MentionSuggestions value={q} onChange={setQ} inputRef={qRef} className="-mt-1" />
              {pollKind === 'text' && (
                <>
                  {opts.map((o, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        className="field min-w-0 flex-1"
                        value={o}
                        maxLength={30}
                        placeholder={`Option ${i + 1}${i > 1 ? ' (facultatif)' : ''}`}
                        onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))}
                      />
                      {i > 1 && (
                        <button
                          type="button"
                          aria-label={`Retirer l’option ${i + 1}`}
                          onClick={() => setOpts(opts.filter((_, j) => j !== i))}
                          className="tap grid h-12 w-12 flex-none place-items-center rounded-full border-0 bg-soft text-mute"
                        >
                          <X size={18} />
                        </button>
                      )}
                    </div>
                  ))}
                  {opts.length < POLL_MAX_OPTIONS && (
                    <button
                      type="button"
                      onClick={() => setOpts([...opts, ''])}
                      className="tap flex h-12 items-center justify-center gap-2 rounded-[24px] border-2 border-dashed border-line bg-transparent text-sm font-bold text-mute"
                    >
                      <Plus size={18} weight="bold" /> Ajouter une option
                    </button>
                  )}
                </>
              )}
              {pollKind === 'image' && (
                <div className="grid grid-cols-2 gap-2">
                  {[0, 1].map((i) => (
                    <div key={i} className="flex flex-col gap-2">
                      <DropZone
                        file={imgOpts[i]}
                        accept="image/*"
                        label="Photo"
                        aspect="1"
                        onPick={(f) => setImgOpts(imgOpts.map((x, j) => (j === i ? f : x)))}
                      />
                      <input
                        className="field"
                        value={opts[i]}
                        maxLength={30}
                        placeholder={`Option ${i + 1}`}
                        onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))}
                      />
                    </div>
                  ))}
                </div>
              )}
              {pollKind === 'slider' && (
                <div className="flex items-center gap-3 rounded-[24px] bg-soft px-4 py-3 text-sm text-mute">
                  <span className="text-2xl">😴</span>
                  <span className="flex-1">Tes amis répondent en faisant glisser un curseur, et découvrent la moyenne.</span>
                  <span className="text-2xl">🔥</span>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <span className="px-1 text-[0.8125rem] font-semibold text-mute">Durée du sondage</span>
                <Seg size="sm" value={duration ?? 0} onChange={(v) => setDuration(v || null)} options={POLL_DURATIONS.map((d) => ({ value: d.hours ?? 0, label: d.label }))} />
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isPublic}
                onClick={() => setIsPublic(!isPublic)}
                className="tap flex min-h-14 items-center gap-3 rounded-[28px] border-0 bg-soft px-3.5 py-2 text-left text-sm font-semibold text-ink"
              >
                <Eye size={22} />
                <span className="flex-1">Montrer qui a voté quoi</span>
                <Switch on={isPublic} />
              </button>
            </>
          )}
        </>
      )}
      <button
        type="button"
        onClick={publish}
        disabled={!valid || busy}
        className={cx(
          'tap h-[54px] flex-none rounded-[27px] border-0 text-base font-bold transition-[background,color,transform] duration-300 active:scale-[.97]',
          valid ? 'bg-ink text-inv' : 'cursor-not-allowed bg-line text-mute',
        )}
      >
        {pubLabel}
      </button>
    </Sheet>
  );
}
