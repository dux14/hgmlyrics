import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

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
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'favicon.svg', 'icons/*.png', 'covers/*.webp'],
      manifest: false, // Using public/manifest.json
      workbox: {
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
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
        // skipWaiting and clientsClaim removed — now controlled by prompt registration
      },
    }),
  ],
  build: {
    target: 'es2020',
    minify: 'terser',
    chunkSizeWarningLimit: 250,
    rollupOptions: {
      output: {
        manualChunks: {
          flexsearch: ['flexsearch'],
        },
      },
    },
  },
});
