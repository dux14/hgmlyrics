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
        globIgnores: [
          '**/assets/phaser-*.js',
          '**/assets/Admin*.js',
          '**/assets/SongEditor-*.js',
          'world/**',
        ],
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
            // GET /api/songs/[id]/audio: la vista inmersiva pide este endpoint EN
            // VIVO (getSongAudio) para obtener la signed URL del mp3 y montar el
            // <audio>. Sin cachearlo, offline el fetch falla y el <audio> nunca se
            // monta (el cache del mp3 ni se consulta). NetworkFirst: online SIEMPRE
            // trae una signed URL fresca (SWR serviría un token viejo/expirado
            // primero); offline sirve el payload cacheado, cuya URL — aunque su
            // token esté "vencido" — nunca sale a la red: la resuelve song-audio-v2
            // por path (ignoreSearch). timings stale offline es aceptable (offline
            // es solo lectura). No matchea /section-audio (editor admin).
            urlPattern: /\/api\/songs\/[^/]+\/audio(?:\?.*)?$/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-song-audio-v1',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
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
            // Pistas mp3 en Supabase Storage: CacheFirst con Range para que el
            // <audio> pueda hacer seek offline (sin rangeRequests el seek rompe).
            //
            // CLAVE (bug T4.2): SOLO se cachea el 200 COMPLETO. El <audio> pide
            // con `Range:` (Chrome bytes=0-..., Safari probe bytes=0-1) y Supabase
            // responde 206 con SOLO ese tramo. Si cacheáramos ese 206,
            // workbox-range-requests lo devuelve tal cual sin recortar (guard de
            // createPartialResponse para respuestas 206) → offline serviría slices
            // corruptos. Por eso `fetchOptions.headers:{}` REEMPLAZA los headers
            // del request (StrategyHandler hace `fetch(request, fetchOptions)` y el
            // constructor Request pisa headers cuando la key existe) → el fetch que
            // puebla la cache va SIN Range → Supabase responde 200 full → se cachea
            // el archivo entero → RangeRequestsPlugin recorta localmente en cada
            // seek. `mode:'cors'` evita respuesta opaca (los players setean
            // crossOrigin='anonymous' antes del src).
            //
            // `matchOptions.ignoreSearch` ignora el `?token=` de la signed URL al
            // LEER: el token rota en cada GET /audio (storage.js re-firma siempre),
            // así que sin esto un reload/offline con token nuevo no matchearía la
            // entrada cacheada. Además evita acumular una entrada por cada reload.
            urlPattern: ({ url, request }) =>
              request.destination === 'audio' && url.hostname.endsWith('.supabase.co'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'song-audio-v2',
              rangeRequests: true,
              matchOptions: { ignoreSearch: true },
              expiration: {
                // 24 (no 8): el gestor de audio de la vista inmersiva cachea
                // pistas POR SECCION ademas del full.mp3 (TANDA 1 players), asi
                // que 8 desalojaba pistas de una misma cancion larga en uso.
                maxEntries: 24,
                maxAgeSeconds: 60 * 60 * 24 * 30,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [200] },
              fetchOptions: { mode: 'cors', headers: {} },
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
          {
            // Assets del mundo virtual (dev-map.json, dev-tileset.png) excluidos
            // del precache por globIgnores: 'world/**' (H10 auditoría, Phaser ya
            // pesa ~1.35MB). Sin esta regla no había NINGUNA vía de cache para
            // ellos y worldMapStore.js los pide en runtime → /mundo quedaba
            // inutilizable offline de forma permanente tras la primera visita.
            urlPattern: /\/world\/.*\.(?:json|png|jpe?g|webp)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'world-assets',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 30,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [0, 200] },
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
          phaser: ['phaser'],
        },
      },
    },
  },
});
