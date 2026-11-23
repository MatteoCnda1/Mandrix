export function fmtCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.', ',').replace(',0', '') + ' M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace('.', ',').replace(',0', '') + ' k';
  return String(n);
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return 'à l’instant';
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${Math.max(1, m)} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'hier';
  if (d < 7) return `il y a ${d} j`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/** Format court pour la liste des conversations : « 2 min », « 1 h », « hier », « lun. ». */
export function shortTime(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'maintenant';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 172800) return 'hier';
  if (s < 604800) return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short' });
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

const pad = (n: number) => String(n).padStart(2, '0');

export interface Countdown {
  d: string;
  h: string;
  m: string;
  s: string;
  line: string;
  done: boolean;
}

export function countdown(targetIso: string | undefined, now = Date.now()): Countdown {
  if (!targetIso) return { d: '–', h: '––', m: '––', s: '––', line: 'Déballage dimanche à 20h', done: false };
  let r = Math.max(0, Math.floor((new Date(targetIso).getTime() - now) / 1000));
  if (r === 0) return { d: '0', h: '00', m: '00', s: '00', line: 'Le déballage est ouvert', done: true };
  const dd = Math.floor(r / 86400);
  r -= dd * 86400;
  const hh = Math.floor(r / 3600);
  r -= hh * 3600;
  const mm = Math.floor(r / 60);
  const ss = r - mm * 60;
  return { d: String(dd), h: pad(hh), m: pad(mm), s: pad(ss), line: `Déballage dans ${dd} j ${pad(hh)} h ${pad(mm)} min`, done: false };
}

export const plural = (n: number, one: string, many: string) => `${fmtCount(n)} ${n > 1 ? many : one}`;
