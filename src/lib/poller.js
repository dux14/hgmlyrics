// src/lib/poller.js
// Polling que respeta la visibilidad de la pestaña: pausa en hidden y al
// volver a visible dispara de inmediato si el intervalo venció (mobile-first:
// no quemar red/batería con la app en background).
export function createPoller(fn, intervalMs) {
  let timer = null;
  let lastRun = 0;
  let running = false;

  const tick = () => {
    lastRun = Date.now();
    fn();
  };
  const schedule = () => {
    clearInterval(timer);
    // El check de visibilidad se mantiene también acá (defensa en profundidad
    // por si start() se llama con la pestaña ya oculta); onVisibility hace la
    // pausa real vía clearInterval cuando se oculta en caliente.
    timer = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      tick();
    }, intervalMs);
  };
  const onVisibility = () => {
    if (!running) return;
    if (document.visibilityState === 'hidden') {
      // Pausa real: sin esto el interval seguía vivo de fondo (solo se
      // saltaba el tick), dejando una ventana donde un tick ya encolado
      // antes del cambio de visibilidad podía ejecutarse igual y solaparse
      // con el tick inmediato de onVisibility al volver.
      clearInterval(timer);
      timer = null;
      return;
    }
    if (Date.now() - lastRun >= intervalMs) tick();
    schedule(); // re-alinear la cadencia al volver
  };

  return {
    start({ immediate = false } = {}) {
      if (running) return;
      running = true;
      lastRun = immediate ? 0 : Date.now();
      if (immediate) tick();
      schedule();
      document.addEventListener('visibilitychange', onVisibility);
    },
    stop() {
      running = false;
      clearInterval(timer);
      timer = null;
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
