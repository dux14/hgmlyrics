/**
 * timingEngine.js — Motor de avance por timings con interludios.
 * Traduce el `currentTime` de un <audio> (vía evento `timeupdate`) al índice
 * de línea activa, y detecta huecos largos entre líneas (interludios) para
 * que el consumidor (D3) pueda animar una espera en vez de quedarse en la
 * última línea cantada.
 *
 * Puro respecto al DOM: no crea ni posee el elemento <audio>, solo escucha
 * los eventos del que se le pasa vía `attach`. Mientras la pista reproduce,
 * un loop de `requestAnimationFrame` recalcula la línea activa en cada
 * frame (resalte fluido, sin el retardo de hasta ~250ms del `timeupdate`
 * nativo); `timeupdate` sigue conectado como respaldo — cubre el estado
 * pausado y los seeks, donde no hay rAF corriendo — misma razón por la que
 * `seekToLine` no fuerza un highlight síncrono: el índice activo se
 * resincroniza en el próximo tick (rAF o `timeupdate`), no en el momento
 * del seek.
 *
 * Precondición (no revalidada, YAGNI): `lines` viene ya ordenado por
 * `startMs` ascendente — el webhook del back garantiza la monotonicidad.
 */

const GAP_INTERLUDIO_MS = 5000;

/**
 * Anticipación aplicada a `currentTime` antes de resolver la línea activa.
 * Compensa la latencia perceptiva entre el resalte visual y el audio: un
 * cambio de línea 120ms "temprano" se percibe sincronizado, no adelantado.
 * Único punto de aplicación: la lectura de `ms` en `syncNow`.
 */
export const LEAD_MS = 120;

/**
 * @typedef {{ i: number, startMs: number }} TimingLine
 */

/**
 * @param {{
 *   lines: TimingLine[],
 *   onLineChange?: (index: number) => void,
 *   onInterlude?: (payload: { index: number, progress: number }) => void,
 * }} opts
 */
export function createTimingEngine({ lines, onLineChange, onInterlude } = {}) {
  const list = lines || [];
  let audioEl = null;
  let lastIndex = -1;
  let rafId = null;

  /**
   * Búsqueda binaria: índice de la última línea con startMs <= ms.
   * Antes de la primera línea (incluye el caso en que la primera línea
   * tiene startMs > 0) devuelve 0 — el consumidor D3 arranca siempre
   * resaltando la línea 0, no un estado "sin línea".
   */
  function lineAt(ms) {
    if (list.length === 0) return 0;
    let lo = 0;
    let hi = list.length - 1;
    let result = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].startMs <= ms) {
        result = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return result;
  }

  function syncNow() {
    if (!audioEl) return;
    const ms = audioEl.currentTime * 1000 + LEAD_MS;
    const index = lineAt(ms);
    const current = list[index];
    const next = list[index + 1];

    // Interludio: hueco largo entre esta línea y la siguiente, y aún no
    // llegamos al inicio de la siguiente. Se emite en cada tick (rAF o
    // timeupdate) dentro del hueco, con progreso 0..1 relativo al gap.
    if (current && next) {
      const gap = next.startMs - current.startMs;
      if (gap > GAP_INTERLUDIO_MS && ms < next.startMs) {
        const progress = Math.min(1, Math.max(0, (ms - current.startMs) / gap));
        onInterlude?.({ index, progress });
      }
    }

    if (index !== lastIndex) {
      lastIndex = index;
      onLineChange?.(index);
    }
  }

  function handleTimeUpdate() {
    syncNow();
  }

  /**
   * Loop de rAF activo solo mientras la pista reproduce. Guard `rafId` para
   * no arrancar dos loops si `play` se dispara dos veces seguidas (algunos
   * navegadores lo hacen tras un `load`/`canplay` cercano).
   */
  function rafTick() {
    syncNow();
    rafId = requestAnimationFrame(rafTick);
  }

  function handlePlay() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(rafTick);
  }

  function handlePause() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  /**
   * Auto-detach defensivo: si ya hay un audio attacheado, se detacha primero
   * para no dejar fugado el listener del anterior (que seguiría disparando
   * handleTimeUpdate leyendo el audioEl nuevo, mezclando datos de pistas).
   * También resetea `lastIndex` — si no, un re-attach con el audio nuevo ya
   * posicionado en la misma línea que tenía el anterior se traga el
   * onLineChange de resincronización (el consumidor D3 se queda sin evento
   * para saber en qué línea está tras el re-attach).
   */
  function attach(el) {
    if (audioEl) detach();
    lastIndex = -1;
    audioEl = el;
    audioEl.addEventListener('timeupdate', handleTimeUpdate);
    audioEl.addEventListener('play', handlePlay);
    audioEl.addEventListener('pause', handlePause);
  }

  function detach() {
    if (audioEl) {
      audioEl.removeEventListener('timeupdate', handleTimeUpdate);
      audioEl.removeEventListener('play', handlePlay);
      audioEl.removeEventListener('pause', handlePause);
    }
    handlePause(); // cancela el rAF si estaba corriendo
    audioEl = null;
  }

  /**
   * Fija `audio.currentTime` a la línea `i`. No dispara onLineChange de forma
   * síncrona: el highlight de la línea activa llega recién en el próximo
   * `timeupdate` nativo del audio (mismo mecanismo que el resto del motor,
   * sin rAF ni actualización forzada).
   */
  function seekToLine(i) {
    if (!audioEl) return;
    const line = list[i];
    if (!line) return;
    audioEl.currentTime = line.startMs / 1000;
  }

  return { attach, detach, seekToLine, lineAt };
}
