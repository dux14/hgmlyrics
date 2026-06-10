/**
 * worldMapStore.js — Punto único de carga del descriptor del mapa activo.
 *
 * Aísla de la escena QUÉ mapa se carga. Hoy devuelve el mapa de dev; en la
 * Fase 3 (editor de mundos) este será el seam donde se sustituya por un mapa
 * cargado desde la base de datos, sin tocar WorldScene.
 */

const DEV_MAP_DESCRIPTOR = {
  key: 'world-map',
  url: '/world/dev-map.json',
  tilesetKey: 'world-tileset',
  tilesetUrl: '/world/dev-tileset.png',
  // Nombre del tileset DENTRO del JSON de Tiled (debe coincidir con tilesets[].name).
  tilesetName: 'dev-tileset',
};

/**
 * Devuelve el descriptor del mapa activo (estático, dev).
 * Retorna una copia nueva en cada llamada para que los consumidores no puedan
 * mutar el estado interno del store.
 *
 * @returns {{ key: string, url: string, tilesetKey: string, tilesetUrl: string, tilesetName: string }}
 */
export function getActiveMapDescriptor() {
  return { ...DEV_MAP_DESCRIPTOR };
}

/**
 * Carga el mapa activo desde la base de datos.
 * Si existe una fila con `is_active = true` en `world_maps`, devuelve el
 * descriptor de DB (con el JSON de Tiled inline). Si no hay fila activa o la
 * consulta falla, degrada al descriptor de dev estático.
 * Nunca lanza al llamador.
 *
 * Descriptor DB:
 *   { key, tilesetKey, tilesetUrl, tilesetName, tiledJson, source: 'db' }
 *
 * Descriptor dev (fallback):
 *   { key, url, tilesetKey, tilesetUrl, tilesetName, source: 'dev' }
 *
 * @param {{ supabase: object }} opts
 * @returns {Promise<object>}
 */
export async function loadActiveMap({ supabase }) {
  try {
    const { data, error } = await supabase
      .from('world_maps')
      .select('id, tiled_json, tileset_url')
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      console.warn('[worldMapStore] Error al consultar world_maps, usando mapa de dev.', error);
      return { ...getActiveMapDescriptor(), source: 'dev' };
    }

    if (!data) {
      // No hay mapa activo en la DB: usar el fallback estático.
      return { ...getActiveMapDescriptor(), source: 'dev' };
    }

    // Derivar el nombre del tileset desde el propio JSON de Tiled.
    const tilesetName = data.tiled_json?.tilesets?.[0]?.name ?? 'world-tileset';

    return {
      key: 'world-map',
      tilesetKey: 'world-tileset',
      tilesetUrl: data.tileset_url,
      tilesetName,
      tiledJson: data.tiled_json,
      source: 'db',
    };
  } catch (err) {
    console.warn('[worldMapStore] Excepción al cargar mapa activo, usando mapa de dev.', err);
    return { ...getActiveMapDescriptor(), source: 'dev' };
  }
}
