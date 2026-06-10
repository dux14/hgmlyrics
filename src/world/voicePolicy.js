/**
 * voicePolicy.js — Politicas de voz por zona.
 *
 * Contiene helpers puros (sin efectos, sin RTCPeerConnection) para aplicar
 * las reglas de capacidad del sistema de voz.
 *
 * Estrategia de cap documentada:
 *   Se conservan los primeros `max` peers de la lista ordenada de forma
 *   estable (orden lexicográfico ascendente de uid). Esto asegura que todos
 *   los clientes de una zona elijan el mismo subconjunto de forma independiente,
 *   sin coordinacion central. Los peers fuera del cap no son conectados;
 *   si un peer con prioridad alta sale, el siguiente entra en el proximo
 *   setPeers (diffPeers lo conecta normalmente).
 *
 * Push-to-talk: fuera del alcance de esta version; el cap es fijo por zona.
 */

/**
 * Limita la lista de peer ids al maximo de publicadores permitidos por zona.
 *
 * La seleccion es determinista: los primeros `max` peers en orden
 * lexicografico (uid) son los que se conectan. Todos los clientes de la
 * misma zona aplican la misma regla y obtienen el mismo subconjunto.
 *
 * @param {string[]} peerIds — lista de peer ids (cualquier orden)
 * @param {number}   [max=8] — maximo de conexiones simultaneas
 * @returns {string[]} subconjunto de hasta `max` peer ids, en orden lex
 */
export function capPublishers(peerIds, max = 8) {
  if (!Array.isArray(peerIds)) return [];
  if (max <= 0) return [];
  // Ordenar de forma estable (lex) y conservar los primeros `max`.
  return [...peerIds].sort().slice(0, max);
}
