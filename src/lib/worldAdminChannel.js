/**
 * worldAdminChannel.js — Canal de administración del mundo virtual.
 *
 * Emite/recibe el evento `map-updated` en el canal `world:admin` vía Supabase
 * Realtime Broadcast. Lo usa el admin para notificar a los clientes cuando
 * activa un mapa nuevo; los clientes lo usan para recargar el mapa en caliente.
 *
 * Uso:
 *   import { joinWorldAdmin } from './worldAdminChannel.js';
 *   import { supabase } from './supabase.js';
 *
 *   const admin = joinWorldAdmin({ supabase });
 *   admin.onMapUpdated((payload) => { ... });
 *   admin.broadcastMapUpdated({ mapId: 'abc', mapName: 'Sala Principal' });
 *   // Al desmontar:
 *   admin.leave();
 */

/**
 * @typedef {{ mapId?: string, mapName?: string }} MapUpdatedPayload
 */

/**
 * Conecta al canal `world:admin` y expone la interfaz de administración.
 *
 * @param {{ supabase: object }} opts — cliente Supabase (real o fake para tests)
 * @returns {{
 *   broadcastMapUpdated: (payload?: MapUpdatedPayload) => void,
 *   onMapUpdated:        (cb: (payload: MapUpdatedPayload) => void) => void,
 *   leave:               () => void,
 * }}
 */
export function joinWorldAdmin({ supabase }) {
  /** @type {((payload: MapUpdatedPayload) => void) | null} */
  let _onMapUpdated = null;

  // Guard idempotente para leave()
  let left = false;

  const channel = supabase.channel('world:admin', {
    config: {
      broadcast: { self: false },
    },
  });

  // Registrar handler de eventos entrantes
  channel.on('broadcast', { event: 'map-updated' }, ({ payload }) => {
    if (_onMapUpdated) _onMapUpdated(payload ?? {});
  });

  channel.subscribe();

  // ---------------------------------------------------------------------------
  // Interfaz pública
  // ---------------------------------------------------------------------------

  /**
   * Emite el evento `map-updated` al canal `world:admin`.
   * El payload es opcional; incluye mapId y/o mapName si están disponibles.
   *
   * @param {MapUpdatedPayload} [payload]
   */
  function broadcastMapUpdated(payload) {
    channel.send({
      type: 'broadcast',
      event: 'map-updated',
      payload: payload ?? {},
    });
  }

  /**
   * Registra el callback que se invoca al recibir un evento `map-updated`.
   * @param {(payload: MapUpdatedPayload) => void} cb
   */
  function onMapUpdated(cb) {
    _onMapUpdated = cb;
  }

  /**
   * Desconecta del canal y limpia el estado local.
   * Idempotente: llamadas adicionales no tienen efecto.
   */
  function leave() {
    if (left) return;
    left = true;
    supabase.removeChannel(channel);
    _onMapUpdated = null;
  }

  return { broadcastMapUpdated, onMapUpdated, leave };
}
