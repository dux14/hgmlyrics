/**
 * cacheClear.js — Limpia todas las caches de la app y recarga.
 *
 * Extraído de Header.js. Consumido por GoToSheet (tile "Limpiar caché").
 */

import { showToast } from './toast.js';

/**
 * Borra todos los caches de la app, muestra un toast y recarga la página.
 */
export async function clearAppCache() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    showToast('Caché limpiado. Recargando...');
    setTimeout(() => location.reload(), 800);
  } catch (_e) {
    showToast('Error al limpiar caché', { type: 'error' });
  }
}
