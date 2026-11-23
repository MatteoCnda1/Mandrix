// Génère les icônes de la PWA à partir de la mascotte Mandrix (npm run icons).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '../public');
const out = path.join(pub, 'icons');
fs.mkdirSync(out, { recursive: true });

const INK = '#0B0F14';
const BLUE = '#2A9DF4';

/** Mascotte en coordonnées « em » (1 = taille du visage), comme dans la maquette CSS. */
function monkey({ ink = INK, face = '#FFFFFF', blue = BLUE } = {}) {
  return `
    <circle cx="0.08" cy="0.45" r="0.15" fill="${blue}"/>
    <circle cx="0.92" cy="0.45" r="0.15" fill="${blue}"/>
    <circle cx="0.5" cy="0.5" r="0.46" fill="${ink}"/>
    <rect x="0.23" y="0.37" width="0.54" height="0.48" rx="0.25" fill="${face}"/>
    <circle cx="0.40" cy="0.51" r="0.04" fill="${ink}"/>
    <circle cx="0.60" cy="0.51" r="0.04" fill="${ink}"/>
    <rect x="0.44" y="0.66" width="0.12" height="0.03" rx="0.015" fill="${ink}"/>
    <rect x="0.5" y="0.76" width="0.36" height="0.17" rx="0.085" fill="${blue}" transform="rotate(-30 0.68 0.845)"/>
    <circle cx="0.995" cy="0.085" r="0.065" fill="${ink}"/>
    <circle cx="1.155" cy="-0.095" r="0.045" fill="${ink}"/>`;
}

const sky = `
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#86C5F4"/>
      <stop offset="0.45" stop-color="#C9E5FA"/>
      <stop offset="1" stop-color="#EDF6FD"/>
    </linearGradient>
  </defs>`;

/** Icône carrée : fond ciel + mascotte centrée occupant `scale` de la largeur. */
function iconSvg(size, scale, rounded = 0) {
  const s = size * scale;
  // Boîte englobante de la mascotte : x ∈ [-0.07, 1.2], y ∈ [-0.14, 1.0]
  const bw = 1.27;
  const bh = 1.14;
  const k = s / bw;
  const tx = (size - bw * k) / 2 + 0.07 * k;
  const ty = (size - bh * k) / 2 + 0.14 * k;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${sky}
    <rect width="${size}" height="${size}" rx="${rounded}" fill="url(#sky)"/>
    <g transform="translate(${tx} ${ty}) scale(${k})">${monkey()}</g>
  </svg>`;
}

function badgeSvg(size) {
  const k = (size * 0.8) / 1.27;
  const tx = (size - 1.27 * k) / 2 + 0.07 * k;
  const ty = (size - 1.14 * k) / 2 + 0.14 * k;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <g transform="translate(${tx} ${ty}) scale(${k})">${monkey({ ink: '#FFFFFF', face: 'transparent', blue: '#FFFFFF' })}</g>
  </svg>`;
}

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.1 -0.2 1.4 1.3">${monkey()}</svg>`;
fs.writeFileSync(path.join(pub, 'favicon.svg'), favicon);

const jobs = [
  ['icon-192.png', iconSvg(192, 0.72)],
  ['icon-512.png', iconSvg(512, 0.72)],
  ['maskable-512.png', iconSvg(512, 0.56)],
  ['apple-touch-icon.png', iconSvg(180, 0.7)],
  ['badge-72.png', badgeSvg(72)],
];
for (const [name, svg] of jobs) {
  await sharp(Buffer.from(svg)).png().toFile(path.join(out, name));
  console.log('✓', name);
}
