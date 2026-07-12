import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
    },
  },
  preview: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
    },
  },
  plugins: [
    tailwindcss(),
    VitePWA({
      // autoUpdate: el nuevo SW toma control apenas se instala, sin esperar
      // que el usuario acepte un prompt. Necesario porque iOS Safari es
      // particularmente lento detectando updates con el patrón 'prompt';
      // usuarios quedan atascados con chunks viejos cacheados. El combo
      // skipWaiting + clientsClaim abajo garantiza que un solo refresh
      // entregue el código nuevo.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon.svg', 'icons/*.png', 'covers/*.webp'],
      manifest: false, // Using public/manifest.json
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//],
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,json,webp,png,svg,woff2}'],
        // Phaser (~1.35MB, solo /mundo) y chunks admin no deben inflar la
        // instalación del SW de cada visitante: se cachean bajo demanda con
        // la regla lazy-chunks de runtimeCaching (H10 auditoría).
        globIgnores: ['**/assets/phaser-*.js', '**/assets/Admin*.js', '**/assets/SongEditor-*.js'],
        runtimeCaching: [
          {
            // Chunks lazy excluidos del precache: URL con hash de build, así
            // que CacheFirst es seguro (nunca cambia el contenido de una URL).
            urlPattern: /\/assets\/(?:phaser|Admin|SongEditor)[^/]*\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'lazy-chunks',
              expiration: {
                maxEntries: 24,
                maxAgeSeconds: 60 * 60 * 24 * 30,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Cache song list API — serve cached instantly, update in background
            urlPattern: /\/api\/songs(\?.*)?$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'api-songs-list',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24, // 24 hours
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Cache individual song detail API.
            // Exclude /api/songs/all explicitly: it's prefetched into IndexedDB
            // by src/lib/offlineCache.js and must always reflect server `version`.
            // cacheName bumped to v2 to evict caches contaminated by previous
            // regex that captured /api/songs/all.
            urlPattern: /\/api\/songs\/(?!all$)[^/]+$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'api-songs-detail-v2',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Portadas/avatares subidos servidos por el backend propio.
            urlPattern: /\/uploads\/.*\.(?:webp|png|jpe?g|gif|avif)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'img-uploads',
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 60 * 60 * 24 * 30,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Imágenes en Supabase Storage (URLs absolutas de otro origen).
            // fetchOptions mode:'cors' fuerza siempre modo cors (Storage público
            // manda access-control-allow-origin: *) para que la misma URL nunca
            // produzca una respuesta opaca: una respuesta cors sí satisface tanto
            // peticiones no-cors como cors, evitando la mezcla de modos que
            // rompía el tile con color extraído (crossOrigin='anonymous').
            urlPattern: ({ url, request }) =>
              request.destination === 'image' && url.hostname.endsWith('.supabase.co'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'img-storage-v2',
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 60 * 60 * 24 * 30,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [200] },
              fetchOptions: { mode: 'cors' },
            },
          },
          // Google Fonts eliminado: fuentes self-hosted en public/fonts/ (precache via globPatterns woff2)
        ],
      },
    }),
    process.env.ANALYZE &&
      visualizer({
        filename: 'dist/stats.html',
        gzipSize: true,
        brotliSize: true,
        template: 'treemap',
      }),
  ].filter(Boolean),
  build: {
    target: 'baseline-widely-available',
    minify: 'terser',
    chunkSizeWarningLimit: 250,
    rollupOptions: {
      output: {
        manualChunks: {
          flexsearch: ['flexsearch'],
          phaser: ['phaser'],
        },
      },
    },
  },
});
