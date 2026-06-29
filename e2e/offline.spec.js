import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:4173';

/**
 * Gate E2E: verifica que recargar offline en cualquier ruta no rompe la app.
 *
 * El router es hash-based (#/song/:id), por lo que el SW solo necesita
 * servir index.html cacheado para cualquier recarga. El build de produccion
 * incluye navigateFallback: 'index.html' en Workbox.
 *
 * Solo funciona con build + preview (no dev, que bypassa el SW).
 */
test('recarga offline en ruta directa no rompe la app', async ({ page, context }) => {
  // Primera carga: el SW se instala; skipWaiting+clientsClaim lo activan de inmediato
  await page.goto(BASE + '/');

  // Segunda carga: SW ya controla la pagina y Workbox cachea los assets
  await page.reload();

  // Confirmar que el SW esta activo y controlando el documento
  await page.evaluate(async () => {
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
      );
    }
  });

  // Esperar que Workbox haya llenado al menos un cache antes de cortar la red
  await page.waitForFunction(() => caches.keys().then((k) => k.length > 0), {
    timeout: 15000,
  });

  // Cortar la red y recargar: el SW debe servir index.html desde cache
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });

  // El shell de la app debe cargar (no una pagina de error del navegador)
  await expect(page.locator('#app')).toBeAttached();
  await expect(page.locator('body')).not.toContainText('ERR_INTERNET_DISCONNECTED');
  await expect(page.locator('body')).not.toContainText('ERR_NETWORK_CHANGED');
});
