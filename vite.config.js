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
        runtimeCaching: [
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
