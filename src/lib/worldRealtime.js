/**
 * worldRealtime.js — Canal Realtime de posiciones y presence para el mundo virtual.
 *
 * Se conecta a `world:global` vía Supabase Realtime Broadcast + Presence.
 * Diseñado para inyección de dependencias (supabase, now) para facilitar pruebas.
 *
 * Uso:
 *   import { joinWorld } from './worldRealtime.js';
 *   import { supabase } from './supabase.js';
 *   import { getSession } from './authStore.js';
 *
 *   const world = joinWorld({ supabase, user: getSession().user });
 *   world.onPeerMove(({ uid, x, y, dir, t }) => { ... });
 *   world.sendPosition(x, y, dir, moving);
 *   // Al salir de la escena:
 *   world.leave();
 */

import { makeRateLimiter } from '../world/throttle.js';

/**
 * Mapea el estado crudo del canal Supabase Realtime a un estado de conexión
 * de alto nivel para la UI.
 *
 * @param {string} status  Estado de `channel.subscribe` (SUBSCRIBED, CHANNEL_ERROR, …).
 * @returns {'connected'|'disconnected'|'connecting'}
 */
export function mapChannelStatus(status) {
  if (status === 'SUBSCRIBED') return 'connected';
  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
    return 'disconnected';
  }
  return 'connecting';
}

/**
 * @typedef {{ uid: string, x: number, y: number, dir: string, t: number }} PeerMovePayload
 * @typedef {{ key: string, newPresences: object[] }} PeerJoinPayload
 * @typedef {{ key: string, leftPresences: object[] }} PeerLeavePayload
 */

/**
 * Conecta al canal `world:global` y expone la interfaz de posiciones + presence.
 *
 * @param {{
 *   supabase: object,          — cliente Supabase (real o fake para tests)
 *   user: { id: string },      — usuario autenticado
 *   now?: () => number         — reloj inyectable (default: Date.now); permite tests deterministas
 * }} opts
 *
 * @returns {{
 *   sendPosition: (x: number, y: number, dir: string, moving: boolean) => void,
 *   onPeerMove:  (cb: (data: PeerMovePayload) => void) => void,
 *   onPeerJoin:  (cb: (data: PeerJoinPayload) => void) => void,
 *   onPeerLeave: (cb: (data: PeerLeavePayload) => void) => void,
 *   leave:       () => void,
 * }}
 */
export function joinWorld({ supabase, user, now = () => Date.now() }) {
  // Rate limiter: máximo 1 envío cada 100ms (10Hz)
  const limiter = makeRateLimiter(100);

  /** @type {((data: PeerMovePayload) => void) | null} */
  let _onPeerMove = null;
  /** @type {((data: PeerJoinPayload) => void) | null} */
  let _onPeerJoin = null;
  /** @type {((data: PeerLeavePayload) => void) | null} */
  let _onPeerLeave = null;
  /** @type {((state: 'connected'|'disconnected'|'connecting') => void) | null} */
  let _onStatus = null;

  // Fix A: guard para no enviar antes de que el canal esté suscrito
  let subscribed = false;
  // Fix B: guard para que leave() sea idempotente
  let left = false;

  // Crear y suscribir el canal
  const channel = supabase.channel('world:global', {
    config: {
      broadcast: { self: false },
      presence: { key: user.id },
    },
  });

  // Registrar handler de posición entrante (broadcast)
  channel.on('broadcast', { event: 'pos' }, ({ payload }) => {
    // Fix C: ignorar payloads nulos para evitar _onPeerMove(null)
    if (!payload) return;
    if (_onPeerMove) _onPeerMove(payload);
  });

  // Registrar handler de presence join
  channel.on('presence', { event: 'join' }, ({ key, newPresences }) => {
    if (_onPeerJoin) _onPeerJoin({ key, newPresences });
  });

  // Registrar handler de presence leave
  channel.on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
    if (_onPeerLeave) _onPeerLeave({ key, leftPresences });
  });

  // Suscribir; al confirmarse, rastrear la presencia del usuario actual.
  // Supabase reinvoca este callback en cada (re)conexión, así que el track()
  // sobre 'connected' cubre el "re-hace presence track" del spec §7.3.
  // Orden importante: actualizar `subscribed` ANTES de notificar el estado, para
  // que un re-emit de posición disparado desde onStatus pase el guard de envío.
  channel.subscribe((status) => {
    const state = mapChannelStatus(status);
    subscribed = state === 'connected';
    if (state === 'connected') {
      // Fire-and-forget; un fallo de track no debe quedar como unhandled rejection.
      Promise.resolve(channel.track({ uid: user.id, name: user.name ?? user.id })).catch(() => {});
    }
    if (_onStatus) _onStatus(state);
  });

  // ---------------------------------------------------------------------------
  // Interfaz pública
  // ---------------------------------------------------------------------------

  /**
   * Envía la posición del usuario local al canal.
   * Si `moving` es false no se envía nada. Respeta el throttle de 100ms.
   *
   * @param {number} x
   * @param {number} y
   * @param {string} dir  — dirección ('up' | 'down' | 'left' | 'right')
   * @param {boolean} moving
   */
  function sendPosition(x, y, dir, moving) {
    if (!moving) return;
    // Fix A: no enviar hasta que el canal esté suscrito
    if (!subscribed) return;
    const t = now();
    if (!limiter(t)) return;
    channel.send({
      type: 'broadcast',
      event: 'pos',
      payload: { uid: user.id, x, y, dir, t },
    });
  }

  /**
   * Registra el callback que se invoca al recibir una posición de otro peer.
   * @param {(data: PeerMovePayload) => void} cb
   */
  function onPeerMove(cb) {
    _onPeerMove = cb;
  }

  /**
   * Registra el callback que se invoca cuando un peer se une al mundo.
   * @param {(data: PeerJoinPayload) => void} cb
   */
  function onPeerJoin(cb) {
    _onPeerJoin = cb;
  }

  /**
   * Registra el callback que se invoca cuando un peer abandona el mundo.
   * @param {(data: PeerLeavePayload) => void} cb
   */
  function onPeerLeave(cb) {
    _onPeerLeave = cb;
  }

  /**
   * Registra el callback que recibe el estado de conexión del canal
   * ('connected' | 'disconnected' | 'connecting') en cada cambio.
   * @param {(state: 'connected'|'disconnected'|'connecting') => void} cb
   */
  function onStatus(cb) {
    _onStatus = cb;
  }

  /**
   * Desconecta del canal y limpia el estado local.
   * Idempotente: llamadas adicionales no tienen efecto.
   */
  function leave() {
    // Fix B: idempotente
    if (left) return;
    left = true;
    supabase.removeChannel(channel);
    _onPeerMove = null;
    _onPeerJoin = null;
    _onPeerLeave = null;
    _onStatus = null;
  }

  return { sendPosition, onPeerMove, onPeerJoin, onPeerLeave, onStatus, leave };
}
