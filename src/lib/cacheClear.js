/**
 * cacheClear.js — Limpia todas las caches de la app y recarga.
 *
 * Extraído de Header.js. Consumido por GoToSheet (tile "Limpiar caché").
 */

import { showToast } from './toast.js';
import { invalidateOfflineCache } from './offlineCache.js';

/**
 * Borra todos los caches de la app (Cache Storage + catálogo offline en
 * IndexedDB), muestra un toast y recarga la página.
 */
export async function clearAppCache() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    // Sin esto, el fallback offline seguía sirviendo letras viejas justo
    // después de "limpiar caché" (H7 auditoría).
    await invalidateOfflineCache();
    showToast('Caché limpiado. Recargando...');
    setTimeout(() => location.reload(), 800);
  } catch (_e) {
    showToast('Error al limpiar caché', { type: 'error' });
  }
}
