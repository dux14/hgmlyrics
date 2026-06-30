/**
 * cacheClear.js — Limpia todas las caches de la app y recarga.
 *
 * Extraído de Header.js. Consumido por GoToSheet (tile "Limpiar caché").
 */

/**
 * Muestra un toast temporal en pantalla.
 * @param {string} message
 */
function showToast(message) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

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
    showToast('Error al limpiar caché');
  }
}
