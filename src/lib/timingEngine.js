/**
 * timingEngine.js — Motor de avance por timings con interludios.
 * Traduce el `currentTime` de un <audio> (vía evento `timeupdate`) al indice
 * de linea activa, y detecta huecos largos entre lineas (interludios) para
 * que el consumidor (D3) pueda animar una espera en vez de quedarse en la
 * ultima linea cantada.
 *
 * Puro respecto al DOM: no crea ni posee el elemento <audio>, solo escucha
 * los eventos del que se le pasa via `attach`. Sin rAF interno: el ritmo de
 * actualizacion lo da el propio `timeupdate` nativo del navegador
 * (~4 veces por segundo), que es mas que suficiente para sincronizar por
 * linea (a diferencia de un afinador o una barra de progreso fina, aqui no
 * se necesita precision de frame).
 *
 * Precondicion (no revalidada, YAGNI): `lines` viene ya ordenado por
 * `startMs` ascendente — el webhook del back garantiza la monotonicidad.
 */

const GAP_INTERLUDIO_MS = 5000;

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

  /**
   * Busqueda binaria: indice de la ultima linea con startMs <= ms.
   * Antes de la primera linea (incluye el caso en que la primera linea
   * tiene startMs > 0) devuelve 0 — el consumidor D3 arranca siempre
   * resaltando la linea 0, no un estado "sin linea".
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

  function handleTimeUpdate() {
    if (!audioEl) return;
    const ms = audioEl.currentTime * 1000;
    const index = lineAt(ms);
    const current = list[index];
    const next = list[index + 1];

    // Interludio: hueco largo entre esta linea y la siguiente, y aun no
    // llegamos al inicio de la siguiente. Se emite en cada timeupdate
    // dentro del hueco, con progreso 0..1 relativo al propio gap.
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

  /**
   * Auto-detach defensivo: si ya hay un audio attacheado, se detacha primero
   * para no dejar fugado el listener del anterior (que seguiria disparando
   * handleTimeUpdate leyendo el audioEl nuevo, mezclando datos de pistas).
   */
  function attach(el) {
    if (audioEl) detach();
    audioEl = el;
    audioEl.addEventListener('timeupdate', handleTimeUpdate);
  }

  function detach() {
    if (audioEl) {
      audioEl.removeEventListener('timeupdate', handleTimeUpdate);
    }
    audioEl = null;
  }

  function seekToLine(i) {
    if (!audioEl) return;
    const line = list[i];
    if (!line) return;
    audioEl.currentTime = line.startMs / 1000;
  }

  return { attach, detach, seekToLine, lineAt };
}
