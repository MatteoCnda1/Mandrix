import { createHash } from 'node:crypto';
import fs from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const api = process.env.API_URL ?? 'http://localhost:3000';

// Empreinte des icônes : ajoutée en ?v=… aux URL des icônes (manifeste, apple-touch-icon, favicon).
// iOS, Android et Cloudflare (qui garde les PNG 4 h) mettent les icônes en cache par URL :
// une nouvelle URL à chaque changement de logo force l'écran d'accueil à récupérer la bonne.
const pub = new URL('./public/', import.meta.url);
const iconFiles = ['favicon.ico', 'favicon.svg', ...fs.readdirSync(new URL('icons/', pub)).map((f) => `icons/${f}`)].sort();
const iconHash = createHash('sha256');
for (const f of iconFiles) iconHash.update(f).update(fs.readFileSync(new URL(f, pub)));
const iconVersion = iconHash.digest('hex').slice(0, 10);
const icon = (p: string) => `${p}?v=${iconVersion}`;

export default defineConfig({
  plugins: [
    {
      name: 'mandrix-icon-version',
      transformIndexHtml: (html) => html.replace(/href="(\/(?:favicon\.(?:ico|svg)|icons\/[\w-]+\.png))"/g, (_, p: string) => `href="${icon(p)}"`),
    },
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // La nouvelle version attend que l'utilisateur clique sur « Mettre à jour ».
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'favicon.ico', 'icons/*.png'],
      manifest: {
        name: 'Mandrix',
        short_name: 'Mandrix',
        description: 'Poste, vote et joue avec tes amis. Chaque dimanche à 20h, tout le monde déballe les photos de la semaine.',
        lang: 'fr',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#E8F2FC',
        theme_color: '#E8F2FC',
        categories: ['social', 'entertainment', 'photo'],
        icons: [
          { src: icon('/icons/icon-192.png'), sizes: '192x192', type: 'image/png' },
          { src: icon('/icons/icon-512.png'), sizes: '512x512', type: 'image/png' },
          { src: icon('/icons/maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'La Pellicule', url: '/pellicule', icons: [{ src: icon('/icons/icon-192.png'), sizes: '192x192' }] },
          { name: 'Make It Friends', url: '/jeu', icons: [{ src: icon('/icons/icon-192.png'), sizes: '192x192' }] },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': api,
      '/media': api,
      '/socket.io': { target: api, ws: true },
    },
  },
  build: { target: 'es2022', sourcemap: false },
});
