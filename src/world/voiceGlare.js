/**
 * Regla determinista de oferta WebRTC para evitar glare (doble oferta).
 *
 * En una malla full-mesh, exactamente uno de los dos pares debe enviar la oferta.
 * La convencion elegida: el par cuyo id es lexicograficamente mayor actua como oferente.
 */

/**
 * Determina si este peer debe enviar la oferta WebRTC al peer remoto.
 *
 * Retorna true solo si myId es estrictamente mayor que peerId en orden
 * lexicografico, garantizando que exactamente uno de los dos pares oferta.
 *
 * @param {string} myId   - Identificador UUID del peer local.
 * @param {string} peerId - Identificador UUID del peer remoto.
 * @returns {boolean}
 */
export function shouldOffer(myId, peerId) {
  return myId > peerId;
}
