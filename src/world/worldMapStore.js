/**
 * worldMapStore.js — Punto único de carga del descriptor del mapa activo.
 *
 * Aísla de la escena QUÉ mapa se carga. Hoy devuelve el mapa de dev; en la
 * Fase 3 (editor de mundos) este será el seam donde se sustituya por un mapa
 * cargado desde la base de datos, sin tocar WorldScene.
 *
 * Funciones admin (E3):
 *   listMaps    — lista todos los mapas vía GET /api/admin/world-map
 *   saveMap     — sube el tileset a Storage y llama POST /api/admin/world-map (create)
 *   activate    — llama POST /api/admin/world-map (activate)
 */

import { getSession } from '../lib/authStore.js';

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

// ---------------------------------------------------------------------------
// Admin helpers
// ---------------------------------------------------------------------------

/** Cabecera de autorización con el token de sesión activo. */
function authHeader() {
  const session = getSession();
  return { Authorization: `Bearer ${session?.access_token ?? ''}` };
}

/**
 * Lista todos los mapas del mundo vía GET /api/admin/world-map.
 *
 * @param {{ supabase: object }} _opts — supabase no se usa aquí (la endpoint
 *   usa el rol de servicio), pero se mantiene por consistencia con loadActiveMap.
 * @returns {Promise<Array<{ id: string, name: string, isActive: boolean, updatedAt: string, zones: Array<{ name: string, channelId: string }> }>>}
 */
export async function listMaps(_opts) {
  const res = await fetch('/api/admin/world-map', { headers: authHeader() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), { status: res.status });
  }
  const { maps } = await res.json();
  return maps;
}

/**
 * Sube el tileset via el endpoint admin /api/admin/tileset-upload (service-role,
 * igual que el avatar se sube via /api/profile/avatar) y crea el mapa via
 * POST /api/admin/world-map con action:"create".
 *
 * El upload directo al bucket "world-maps" desde el cliente está bloqueado por RLS
 * (no hay policy INSERT para `authenticated`). Rutar por el endpoint resuelve eso.
 *
 * @param {{ supabase: object, name: string, tiledJson: object, tilesetBlob: Blob }} opts
 * @returns {Promise<{ map: object, zones: Array<{ name: string, channelId: string }> }>}
 */
export async function saveMap({ supabase: _supabase, name, tiledJson, tilesetBlob }) {
  // Subir el tileset a traves del endpoint admin (usa service-role internamente).
  const formData = new FormData();
  formData.append('tileset', tilesetBlob);
  formData.append('mapName', name.trim());

  const uploadRes = await fetch('/api/admin/tileset-upload', {
    method: 'POST',
    headers: authHeader(),
    body: formData,
  });
  if (!uploadRes.ok) {
    const uploadBody = await uploadRes.json().catch(() => ({}));
    throw new Error(`Storage upload: ${uploadBody.error ?? `HTTP ${uploadRes.status}`}`);
  }
  const { url: tilesetUrl } = await uploadRes.json();

  // Crear el mapa en la base de datos a través del endpoint admin.
  const res = await fetch('/api/admin/world-map', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ action: 'create', name: name.trim(), tiledJson, tilesetUrl }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), {
      status: res.status,
      errors: body.errors,
    });
  }

  return body; // { map, zones }
}

/**
 * Activa un mapa existente (desactiva el actual) vía POST /api/admin/world-map.
 *
 * @param {{ supabase: object, id: string }} opts
 * @returns {Promise<{ map: object }>}
 */
export async function activate({ id }) {
  const res = await fetch('/api/admin/world-map', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ action: 'activate', id }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), { status: res.status });
  }
  return body; // { map }
}
