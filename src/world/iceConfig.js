/**
 * iceConfig.js — Configuración de servidores ICE (STUN/TURN) para WebRTC.
 *
 * Mantiene la lógica pura y testeable: recibe el objeto `env` como parámetro
 * en lugar de leer directamente `import.meta.env`, para facilitar las pruebas.
 *
 * Uso en producción:
 *   import { getIceServers } from './iceConfig.js';
 *   const iceServers = getIceServers(import.meta.env);
 *
 * Variables de entorno opcionales (TURN):
 *   VITE_TURN_URL         — URL del servidor TURN (ej: turn:mi-servidor.com:3478)
 *   VITE_TURN_USERNAME    — Usuario para autenticación TURN (opcional)
 *   VITE_TURN_CREDENTIAL  — Contraseña para autenticación TURN (opcional)
 */

/**
 * Retorna el array `iceServers` para RTCPeerConnection.
 *
 * - Por defecto incluye dos servidores STUN públicos de Google.
 * - Si `env.VITE_TURN_URL` está definido y no vacío, agrega un servidor TURN
 *   con credenciales opcionales (VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL).
 *
 * @param {Record<string, string | undefined>} env — objeto de variables de entorno
 * @returns {RTCIceServer[]}
 */
export function getIceServers(env = {}) {
  /** @type {RTCIceServer[]} */
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  const turnUrl = env.VITE_TURN_URL;
  if (turnUrl && turnUrl.trim() !== '') {
    /** @type {RTCIceServer} */
    const turnEntry = { urls: turnUrl.trim() };

    const username = env.VITE_TURN_USERNAME;
    const credential = env.VITE_TURN_CREDENTIAL;

    if (username) turnEntry.username = username;
    if (credential) turnEntry.credential = credential;

    servers.push(turnEntry);
  }

  return servers;
}
