import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const api = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [
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
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#E8F2FC',
        theme_color: '#E8F2FC',
        categories: ['social', 'entertainment', 'photo'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'La Pellicule', url: '/pellicule', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Make It Friends', url: '/jeu', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
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
