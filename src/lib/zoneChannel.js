/**
 * zoneChannel.js — Canal de chat por zona para el mundo virtual.
 *
 * Se conecta a `zone:{channelId}` vía Supabase Realtime Broadcast.
 * Diseñado para inyección de dependencias (supabase) para facilitar pruebas.
 *
 * Uso:
 *   import { joinZone } from './zoneChannel.js';
 *   import { supabase } from './supabase.js';
 *   import { getSession } from './authStore.js';
 *
 *   const zone = joinZone({ supabase, channelId: 'sala-1', user: getSession().user });
 *   zone.onMessage(({ uid, name, text, ts }) => { ... });
 *   zone.send('Hola a todos');
 *   // Al salir de la zona:
 *   zone.leave();
 */

/**
 * @typedef {{ uid: string, name: string, text: string, ts: number }} MsgPayload
 */

/**
 * Conecta al canal `zone:{channelId}` y expone la interfaz de chat.
 *
 * @param {{
 *   supabase:   object,                         — cliente Supabase (real o fake para tests)
 *   channelId:  string,                         — identificador de la zona
 *   user: { id: string, display_name?: string, email?: string } — usuario autenticado
 * }} opts
 *
 * @returns {{
 *   send:      (text: string) => void,
 *   onMessage: (cb: (data: MsgPayload) => void) => void,
 *   leave:     () => void,
 * }}
 */
export function joinZone({ supabase, channelId, user }) {
  /** @type {((data: MsgPayload) => void) | null} */
  let _onMessage = null;

  // Guard para no enviar antes de que el canal esté suscrito
  let subscribed = false;
  // Guard para que leave() sea idempotente
  let left = false;

  // Crear y suscribir el canal
  const channel = supabase.channel('zone:' + channelId, {
    config: {
      broadcast: { self: false },
    },
  });

  // Registrar handler de mensajes entrantes (broadcast)
  channel.on('broadcast', { event: 'msg' }, ({ payload }) => {
    if (!payload) return;
    if (_onMessage) _onMessage(payload);
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
   * Envía un mensaje de texto al canal de la zona.
   * No envía nada si el canal aún no está suscrito.
   *
   * @param {string} text
   */
  function send(text) {
    // No enviar hasta que el canal esté suscrito
    if (!subscribed) return;
    const name = user.display_name ?? user.email ?? 'anon';
    channel.send({
      type: 'broadcast',
      event: 'msg',
      payload: { uid: user.id, name, text, ts: Date.now() },
    });
  }

  /**
   * Registra el callback que se invoca al recibir un mensaje de otro participante.
   * @param {(data: MsgPayload) => void} cb
   */
  function onMessage(cb) {
    _onMessage = cb;
  }

  /**
   * Desconecta del canal y limpia el estado local.
   * Idempotente: llamadas adicionales no tienen efecto.
   */
  function leave() {
    if (left) return;
    left = true;
    supabase.removeChannel(channel);
    _onMessage = null;
  }

  return { send, onMessage, leave };
}
