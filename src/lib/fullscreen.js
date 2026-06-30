/**
 * Fullscreen nativo como MEJORA progresiva. La base del escenario es el overlay
 * CSS (funciona en iOS Safari, que no soporta requestFullscreen de elementos).
 * Estos helpers añaden fullscreen real donde existe (Android Chrome, desktop) y
 * degradan en silencio donde no.
 */
export function requestStageFullscreen(el = document.documentElement) {
  if (el && typeof el.requestFullscreen === 'function') {
    return Promise.resolve(el.requestFullscreen()).catch(() => {});
  }
  return Promise.resolve();
}

export function exitStageFullscreen() {
  if (typeof document !== 'undefined' && document.fullscreenElement && typeof document.exitFullscreen === 'function') {
    return Promise.resolve(document.exitFullscreen()).catch(() => {});
  }
  return Promise.resolve();
}
