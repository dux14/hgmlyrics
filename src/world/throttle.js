/**
 * throttle.js — Rate limiter de envío de posición para el mundo virtual.
 *
 * Lógica pura (sin Date.now(), sin efectos secundarios). El tiempo se pasa
 * explícitamente para facilitar las pruebas.
 */

/**
 * Crea un limitador de tasa que permite a lo sumo un evento cada `intervalMs`
 * milisegundos. El tiempo se pasa explícitamente al invocar el limitador.
 *
 * @param {number} intervalMs  — Intervalo mínimo entre eventos permitidos (ms).
 * @returns {(now: number) => boolean}  Función que retorna `true` si el evento
 *   debe pasar (y registra `now` como último instante), o `false` si debe
 *   descartarse porque aún no transcurrió el intervalo.
 */
export function makeRateLimiter(intervalMs) {
  let last = -Infinity;

  return function limiter(now) {
    if (now - last >= intervalMs) {
      last = now;
      return true;
    }
    return false;
  };
}
