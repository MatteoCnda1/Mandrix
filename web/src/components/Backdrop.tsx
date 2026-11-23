import type { CSSProperties } from 'react';
import { useNow } from '../lib/hooks';
import { useAmbiance } from '../lib/theme';

// Palette du ciel au fil de la journée (heure locale) : [heure, haut, bas].
const SKY: [number, string, string][] = [
  [0, '#0b1730', '#1d2b4f'],
  [5.5, '#1c2550', '#4a3f6e'],
  [7, '#5a6aa3', '#f6b29a'],
  [9, '#7fb8ef', '#e3f0fb'],
  [13, '#4ea4ee', '#cfe8fb'],
  [17.5, '#6aa6e3', '#fbdcae'],
  [20, '#3d3f7c', '#ff9e6b'],
  [21.5, '#1a2150', '#5b3f73'],
  [24, '#0b1730', '#1d2b4f'],
];

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) =>
  `rgb(${hex(a)
    .map((v, i) => Math.round(v + (hex(b)[i] - v) * t))
    .join(' ')})`;

/** Variables CSS du ciel pour un instant donné ; doré le dimanche entre 19 h et 21 h (déballage). */
export function skyAt(d: Date): CSSProperties {
  const h = d.getHours() + d.getMinutes() / 60;
  if (d.getDay() === 0 && h >= 19 && h < 21) {
    return {
      '--sky-top': '#f2a65a',
      '--sky-bottom': '#ffe3a8',
      '--sun-x': 50,
      '--sun-y': 78,
      '--sun-o': 1,
      '--star-o': 0,
      '--glow': 'rgba(255, 210, 120, 0.95)',
    } as CSSProperties;
  }
  const i = SKY.findIndex(([at]) => at > h);
  const [h0, t0, b0] = SKY[i - 1];
  const [h1, t1, b1] = SKY[i];
  const t = (h - h0) / (h1 - h0);
  // Le soleil traverse le ciel de 7 h à 21 h, en arc.
  const day = Math.min(1, Math.max(0, (h - 7) / 14));
  const up = h >= 7 && h <= 21;
  return {
    '--sky-top': mix(t0, t1, t),
    '--sky-bottom': mix(b0, b1, t),
    '--sun-x': 8 + day * 84,
    '--sun-y': 80 - Math.sin(day * Math.PI) * 66,
    '--sun-o': up ? 1 : 0,
    '--star-o': h < 6 || h > 21 ? 0.9 : h < 7 ? 7 - h : h > 20.5 ? (h - 20.5) * 1.8 : 0,
    '--glow': h > 17 && h < 21 ? 'rgba(255, 190, 120, 0.85)' : 'rgba(255, 240, 190, 0.85)',
  } as CSSProperties;
}

function RealSky() {
  const now = useNow(60_000);
  return (
    <div className="ambiance realsky" style={skyAt(new Date(now))} aria-hidden="true">
      <i className="stars" />
      <i className="stars s2" />
      <i className="sun" />
    </div>
  );
}

/** Fond de l'application selon l'ambiance choisie dans Réglages. */
export function Backdrop() {
  const [ambiance] = useAmbiance();
  if (ambiance === 'ciel') {
    return (
      <div className="ambiance sky" aria-hidden="true">
        <i className="stars" />
        <i className="stars s2" />
        <i className="cloud" />
        <i className="cloud" />
        <i className="cloud" />
        <i className="cloud" />
      </div>
    );
  }
  if (ambiance === 'doodles') {
    return (
      <div className="ambiance doodles" aria-hidden="true">
        <i className="tile" />
        <i className="grain" />
      </div>
    );
  }
  if (ambiance === 'heure') return <RealSky />;
  return (
    <div className="aurora" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}
