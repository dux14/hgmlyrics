/**
 * preloadErrorGuard.js — recuperación de chunks lazy con hash viejo tras un deploy.
 *
 * Tras un deploy, el SW nuevo (skipWaiting+clientsClaim) controla pestañas
 * cuyo JS en memoria aún referencia chunks lazy con hash viejo que ya no
 * existen en Vercel. Vite emite 'vite:preloadError' al fallar un import()
 * dinámico: recargar una vez entrega el index.html nuevo. El guard de
 * sessionStorage evita un loop si el reload tampoco resuelve (H6 auditoría).
 */
export const PRELOAD_RELOAD_KEY = 'hkn-preload-reload';

/**
 * Registra el listener de 'vite:preloadError'. Debe llamarse a nivel de
 * módulo (antes de boot) para cubrir errores de import() en cualquier punto
 * del arranque.
 */
export function initPreloadErrorGuard() {
  globalThis.addEventListener('vite:preloadError', (event) => {
    try {
      if (sessionStorage.getItem(PRELOAD_RELOAD_KEY)) return;
    } catch (_) {
      // Sin storage no hay guard posible contra loops de reload: dejar que
      // Vite propague el error (comportamiento previo al fix) en vez de
      // recargar sin protección o suprimir el error en silencio.
      return;
    }
    event.preventDefault();
    try {
      sessionStorage.setItem(PRELOAD_RELOAD_KEY, '1');
    } catch (_) {
      /* storage bloqueado */
    }
    globalThis.location.reload();
  });
}

/**
 * Rearma el guard tras un boot exitoso (los chunks actuales cargan bien),
 * para que un futuro deploy pueda volver a disparar un reload. Se llama
 * desde un `finally` en boot() para cubrir también el caso de boot fallido
 * a mitad de camino, no solo el camino feliz.
 */
export function clearPreloadErrorGuard() {
  try {
    sessionStorage.removeItem(PRELOAD_RELOAD_KEY);
  } catch (_) {
    /* storage bloqueado */
  }
}
