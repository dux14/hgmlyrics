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
 * Devuelve el descriptor del mapa activo.
 * Retorna una copia nueva en cada llamada para que los consumidores no puedan
 * mutar el estado interno del store.
 *
 * @returns {{ key: string, url: string, tilesetKey: string, tilesetUrl: string, tilesetName: string }}
 */
export function getActiveMapDescriptor() {
  return { ...DEV_MAP_DESCRIPTOR };
}
