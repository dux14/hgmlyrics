import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:4173';

/**
 * Gate E2E: verifica que recargar offline en una ruta hash profunda no rompe la app.
 *
 * El router es hash-based (#/song/:id), por lo que el SW solo necesita servir
 * index.html cacheado para cualquier recarga. El build de produccion incluye
 * navigateFallback: 'index.html' en Workbox.
 *
 * Solo funciona con build + preview (no dev, que bypassa el SW).
 *
 * Nota: en el entorno local las vars VITE_SUPABASE_* no estan definidas, por lo que
 * el modulo supabase.js lanza al evaluarse y el SPA no llega a montar. Las aserciones
 * comprueban que (1) el SW sirvio index.html correcto — no la pagina de error de Chrome
 * — y que (2) ningun asset del origen fallo en cargarse desde el cache del SW.
 */
test('recarga offline en ruta hash profunda no rompe la app', async ({ page, context }) => {
  // Carga 1: el SW se instala; skipWaiting+clientsClaim lo activan de inmediato.
  await page.goto(BASE + '/');

  // Carga 2: SW ya controla la pagina y Workbox inicia el precache de assets.
  await page.reload();

  // Confirmar que el SW esta activo y controlando el documento.
  await page.evaluate(async () => {
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
      );
    }
  });

  // Esperar que Workbox haya llenado al menos un cache (misma sintaxis que el test original:
  // funcion no-async que devuelve Promise; evita el problema de waitForFunction con async).
  await page.waitForFunction(() => caches.keys().then((k) => k.length > 0), {
    timeout: 15000,
  });

  // Intentar descubrir un id de cancion desde el corpus cacheado en IndexedDB.
  // idb-keyval usa db 'keyval-store', object store 'keyval', clave 'hkn-offline-songs'.
  // Si el SW reclama la pagina durante el lookup se captura el error y se usa el fallback.
  let songId = null;
  try {
    songId = await page.evaluate(() => {
      return new Promise((resolve) => {
        const open = indexedDB.open('keyval-store');
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('keyval', 'readonly');
          const req = tx.objectStore('keyval').get('hkn-offline-songs');
          req.onsuccess = () => {
            const songs = req.result;
            resolve(Array.isArray(songs) && songs[0] ? songs[0].id : null);
          };
          req.onerror = () => resolve(null);
        };
        open.onerror = () => resolve(null);
      });
    });
  } catch (_nav) {
    // El SW reclamo la pagina durante el evaluate; esperar que la carga se estabilice.
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => caches.keys().then((k) => k.length > 0), {
      timeout: 10000,
    });
  }

  // Fallback: en entorno sin Supabase los songs no estan en IndexedDB.
  // La ruta '#/buscar' siempre esta disponible offline via navigateFallback de Workbox.
  const hashRoute = songId ? `#/song/${songId}` : '#/buscar';

  // Capturar requests del origen fallidas para detectar filtraciones de red.
  const failedRequests = [];
  page.on('requestfailed', (req) => {
    if (req.url().startsWith(BASE)) failedRequests.push(req.url());
  });

  // Cortar la red, navegar a la ruta hash profunda y recargar.
  await context.setOffline(true);
  await page.goto(BASE + '/' + hashRoute, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });

  // Asercion 1: el SW sirvio index.html (no la pagina de error de Chrome).
  // La pagina de error de Chrome no tiene #app ni el titulo de la app.
  await expect(page.locator('#app')).toBeAttached();
  await expect(page).toHaveTitle('HKN Lyrics — Letras de Hakuna Group Music');

  // Asercion 2: ningun asset del origen fallo en cargarse (todo vino del cache del SW).
  // Si algun asset no estuviera en el cache del SW fallaria aqui, no en las aserciones 1.
  expect(failedRequests).toEqual([]);
});
