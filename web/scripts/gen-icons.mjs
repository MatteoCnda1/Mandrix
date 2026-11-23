// Génère les icônes de la PWA à partir des masters du logo (docs/logo/symbol) : npm run icons.
// Les masters sont la source de vérité ; ce script ne redessine rien, il ne fait que rastériser et copier.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const masters = path.join(here, '../../docs/logo/symbol');
const pub = path.join(here, '../public');
const icons = path.join(pub, 'icons');
const assets = path.join(here, '../src/assets/logo');
const MASTER_SIZE = 256; // viewBox des masters
const BADGE_PADDING = 0.06; // marge du badge de notification (fraction de la taille)
const ICO_SIZES = [16, 32, 48];
const SKY = '#C9E5FA'; // --page, fond de secours des icônes opaques

function master(name) {
  const file = path.join(masters, name);
  if (!fs.existsSync(file)) throw new Error(`Master introuvable : ${file}`);
  return fs.readFileSync(file);
}

/** SVG -> PNG carré de `size` px, rendu à la bonne densité pour rester net. */
function raster(svg, size) {
  return sharp(svg, { density: (72 * size) / MASTER_SIZE }).resize(size, size).png();
}

/** Même rendu sans canal alpha : iOS et les icônes maskable attendent une image pleine. */
function opaque(svg, size) {
  return raster(svg, size).flatten({ background: SKY });
}

async function badge(svg, size) {
  const pad = Math.round(size * BADGE_PADDING);
  const inner = await raster(svg, size - 2 * pad).toBuffer();
  return sharp(inner)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png();
}

/** favicon.ico multi-tailles : en-tête ICONDIR + une entrée par PNG embarqué. */
async function ico(svg, sizes) {
  const pngs = await Promise.all(sizes.map((s) => raster(svg, s).toBuffer()));
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach((png, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(sizes[i] % 256, entry);
    header.writeUInt8(sizes[i] % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...pngs]);
}

// Tous les masters sont lus avant la première écriture : un fichier manquant n'écrase rien.
const src = {
  symbol: master('mandrix-symbol.svg'),
  small: master('mandrix-symbol-small.svg'),
  safe: master('mandrix-symbol-safe.svg'),
  square: master('mandrix-symbol-square.svg'),
  badge: master('mandrix-symbol-small-white.svg'),
};

fs.mkdirSync(icons, { recursive: true });
fs.mkdirSync(assets, { recursive: true });

fs.writeFileSync(path.join(assets, 'mandrix-symbol.svg'), src.symbol);
fs.writeFileSync(path.join(pub, 'favicon.svg'), src.small);
fs.writeFileSync(path.join(pub, 'favicon.ico'), await ico(src.small, ICO_SIZES));
console.log('✓ favicon.svg, favicon.ico, src/assets/logo/mandrix-symbol.svg');

const jobs = [
  ['icon-192.png', raster(src.symbol, 192)],
  ['icon-512.png', raster(src.symbol, 512)],
  ['maskable-512.png', opaque(src.safe, 512)],
  ['apple-touch-icon.png', opaque(src.square, 180)],
  ['badge-72.png', await badge(src.badge, 72)],
];
for (const [name, image] of jobs) {
  await image.toFile(path.join(icons, name));
  console.log('✓', name);
}
