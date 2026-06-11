/**
 * zoneChannelsDiff.js — Helper puro para detectar cambios de channelId entre mapas.
 *
 * Cuando el admin activa un nuevo mapa, algunas zonas pueden haber cambiado de
 * channelId o desaparecido. Los usuarios que estén en esas zonas perderán su
 * conexión de chat/voz. Este helper calcula esos cambios para que el panel
 * pueda mostrar una advertencia antes de confirmar la activación.
 *
 * Uso:
 *   import { diffZoneChannels } from './zoneChannelsDiff.js';
 *
 *   const { changed, removed } = diffZoneChannels(currentZones, nextZones);
 *   // changed → zonas cuyo channelId cambió (mismo nombre, distinto channelId)
 *   // removed → zonas que desaparecen por completo del nuevo mapa
 */

/**
 * @typedef {{ name: string, channelId: string }} ZoneInfo
 */

/**
 * Compara dos listas de zonas y devuelve los cambios de channelId.
 *
 * La comparación usa el `name` de la zona como clave de identidad, ya que es
 * el campo más estable (el channelId puede cambiar intencionalmente).
 *
 * - `changed`: zonas que existen en ambos mapas (mismo nombre) pero cuyo
 *   channelId difiere → los usuarios en esas zonas perderán su sesión actual.
 * - `removed`: zonas que están en el mapa actual pero no aparecen en el nuevo
 *   mapa → los usuarios en esas zonas perderán su sesión sin reubicación.
 *
 * @param {ZoneInfo[]} currentZones — zonas del mapa actualmente activo
 * @param {ZoneInfo[]} nextZones    — zonas del mapa que se va a activar
 * @returns {{ changed: ZoneInfo[], removed: ZoneInfo[] }}
 */
export function diffZoneChannels(currentZones, nextZones) {
  const nextByName = new Map(nextZones.map((z) => [z.name, z]));

  /** @type {ZoneInfo[]} */
  const changed = [];
  /** @type {ZoneInfo[]} */
  const removed = [];

  for (const cur of currentZones) {
    const next = nextByName.get(cur.name);
    if (!next) {
      // La zona desaparece por completo en el nuevo mapa.
      removed.push(cur);
    } else if (next.channelId !== cur.channelId) {
      // La zona existe pero con un channelId diferente.
      changed.push(cur);
    }
  }

  return { changed, removed };
}
