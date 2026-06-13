/**
 * voiceSignaling.js — Capa de señalización WebRTC para el mundo virtual.
 *
 * Transporta offers, answers e ICE candidates entre pares a través del canal
 * `signal:{channelId}` vía Supabase Realtime Broadcast. Cada mensaje incluye
 * el campo `to` (uid del destinatario) para que cada cliente filtre los
 * mensajes que no le corresponden.
 *
 * Uso:
 *   import { joinSignaling } from './voiceSignaling.js';
 *   import { supabase } from './supabase.js';
 *
 *   const sig = joinSignaling({ supabase, channelId: 'zona-1', user });
 *   sig.onSignal(({ fromUid, toUid, type, payload }) => { ... });
 *   sig.sendSignal(remotePeerId, { type: 'offer', payload: localSdp });
 *   // Al salir de la zona o al cerrar la conexión:
 *   sig.leave();
 */

/**
 * @typedef {'offer' | 'answer' | 'ice'} SignalType
 *
 * @typedef {{
 *   fromUid:  string,
 *   toUid:    string,
 *   type:     SignalType,
 *   payload:  any,
 * }} SignalEvent
 */

/**
 * Conecta al canal `signal:{channelId}` y expone la interfaz de señalización.
 *
 * @param {{
 *   supabase:  object,                  — cliente Supabase (real o fake para tests)
 *   channelId: string,                  — identificador de la zona
 *   user:      { id: string }           — usuario autenticado; su id es el peer id
 * }} opts
 *
 * @returns {{
 *   sendSignal: (toUid: string, opts: { type: SignalType, payload: any }) => void,
 *   onSignal:   (cb: (event: SignalEvent) => void) => void,
 *   leave:      () => void,
 * }}
 */
export function joinSignaling({ supabase, channelId, user }) {
  /** @type {((event: SignalEvent) => void) | null} */
  let _onSignal = null;

  // Guard para no enviar antes de que el canal esté suscrito
  let subscribed = false;
  // Guard para que leave() sea idempotente
  let left = false;

  // Crear y suscribir el canal de señalización
  const channel = supabase.channel('signal:' + channelId, {
    config: {
      broadcast: { self: false },
    },
  });

  // Registrar handler de señales entrantes (broadcast)
  channel.on('broadcast', { event: 'sig' }, ({ payload }) => {
    if (!payload) return;
    // Filtrar señales no dirigidas a este usuario
    if (payload.to !== user.id) return;
    if (_onSignal) {
      _onSignal({
        fromUid: payload.from,
        toUid: payload.to,
        type: payload.type,
        payload: payload.payload,
      });
    }
  });

  // Suscribir; al confirmarse, marcar el canal como listo para enviar
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      subscribed = true;
    }
  });

  // ---------------------------------------------------------------------------
  // Interfaz pública
  // ---------------------------------------------------------------------------

  /**
   * Envía una señal WebRTC (offer, answer o ICE candidate) a un peer remoto.
   * No envía nada si el canal aún no está suscrito.
   *
   * @param {string} toUid — uid del destinatario
   * @param {{ type: SignalType, payload: any }} opts
   */
  function sendSignal(toUid, { type, payload }) {
    // No enviar hasta que el canal esté suscrito
    if (!subscribed) return;
    channel.send({
      type: 'broadcast',
      event: 'sig',
      payload: { from: user.id, to: toUid, type, payload },
    });
  }

  /**
   * Registra el callback que se invoca al recibir una señal dirigida a este usuario.
   * @param {(event: SignalEvent) => void} cb
   */
  function onSignal(cb) {
    _onSignal = cb;
  }

  /**
   * Desconecta del canal de señalización y limpia el estado local.
   * Idempotente: llamadas adicionales no tienen efecto.
   */
  function leave() {
    if (left) return;
    left = true;
    supabase.removeChannel(channel);
    _onSignal = null;
  }

  return { sendSignal, onSignal, leave };
}
