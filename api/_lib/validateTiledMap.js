/**
 * Validador puro del formato Tiled JSON para mapas del mundo virtual.
 *
 * No realiza I/O. Se puede importar desde Vercel Functions (Node ESM) y
 * desde las pruebas de Vitest sin ninguna dependencia de entorno de navegador.
 *
 * @module validateTiledMap
 */

// ---------------------------------------------------------------------------
// Constantes de capas aceptadas (tolerancia de nombres)
// ---------------------------------------------------------------------------

/**
 * Nombres aceptados (en minúsculas) para la capa de suelo.
 * Acepta: "suelo", "floor".
 */
const FLOOR_NAMES = ['suelo', 'floor'];

/**
 * Nombres aceptados (en minúsculas) para la capa de colisión.
 * Acepta: "colisión", "colision", "collision".
 * Se normaliza quitando la tilde antes de comparar.
 */
const COLLISION_NAMES = ['colisión', 'colision', 'collision'];

/** Normaliza una cadena a minúsculas para comparación case-insensitive. */
function lower(s) {
  return typeof s === 'string' ? s.toLowerCase() : '';
}

// ---------------------------------------------------------------------------
// Helpers de validación de dimensiones
// ---------------------------------------------------------------------------

/**
 * Devuelve true si el valor es un entero estrictamente positivo.
 *
 * @param {unknown} v
 * @returns {boolean}
 */
function isPosInt(v) {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

// ---------------------------------------------------------------------------
// Validación de zonas
// ---------------------------------------------------------------------------

/**
 * Valida los objetos del objectgroup "zones" y acumula errores.
 * Devuelve las zonas válidas (name + channelId) que se pudieron extraer.
 *
 * @param {object[]} objects - Array de objetos Tiled del layer zones.
 * @param {string[]} errors - Array donde se acumulan los mensajes de error.
 * @returns {{ name: string, channelId: string }[]}
 */
function validateZoneObjects(objects, errors) {
  const zones = [];
  const seenChannelIds = new Set();

  objects.forEach((obj, idx) => {
    const label = `Zona ${idx}`;
    const props = Object.fromEntries(((obj && obj.properties) || []).map((p) => [p.name, p.value]));

    let nameOk = true;
    let channelIdOk = true;

    // Validar name
    if (!props.name || typeof props.name !== 'string' || props.name.trim() === '') {
      errors.push(`${label}: la propiedad "name" es obligatoria y no puede estar vacía.`);
      nameOk = false;
    }

    // Validar channelId
    if (!props.channelId || typeof props.channelId !== 'string' || props.channelId.trim() === '') {
      errors.push(
        `${label} ("${props.name || '?'}"): la propiedad "channelId" es obligatoria y no puede estar vacía.`,
      );
      channelIdOk = false;
    } else if (seenChannelIds.has(props.channelId)) {
      errors.push(`channelId duplicado: "${props.channelId}" aparece en más de una zona.`);
      channelIdOk = false;
    } else {
      seenChannelIds.add(props.channelId);
    }

    // Solo acumular la zona si ambos campos son válidos y únicos
    if (nameOk && channelIdOk) {
      zones.push({ name: props.name, channelId: props.channelId });
    }
  });

  return zones;
}

// ---------------------------------------------------------------------------
// Función principal exportada
// ---------------------------------------------------------------------------

/**
 * Valida un objeto JSON en formato Tiled para su uso como mapa del mundo.
 *
 * Acumula TODOS los errores encontrados (no se detiene al primero) para que
 * el administrador vea de una sola pasada todo lo que debe corregir.
 *
 * @param {unknown} json - Contenido parseado del archivo map.json de Tiled.
 * @returns {{ ok: boolean, errors: string[], zones: { name: string, channelId: string }[] }}
 */
export function validateTiledMap(json) {
  const errors = [];
  let zones = [];

  // ------------------------------------------------------------------
  // 1. Tipo básico: debe ser un objeto plano (no null, no array, no primitivo)
  // ------------------------------------------------------------------
  if (json === null || json === undefined || typeof json !== 'object' || Array.isArray(json)) {
    errors.push('El archivo no es un objeto JSON válido de Tiled.');
    return { ok: false, errors, zones };
  }

  // ------------------------------------------------------------------
  // 2. Mapa infinito: no soportado
  // ------------------------------------------------------------------
  if (json.infinite === true) {
    errors.push(
      'Los mapas infinitos (infinite: true) no están soportados. Usa un mapa de tamaño fijo.',
    );
  }

  // ------------------------------------------------------------------
  // 3. Dimensiones globales: width, height, tilewidth, tileheight
  // ------------------------------------------------------------------
  if (!isPosInt(json.width)) {
    errors.push(
      `"width" debe ser un entero positivo (valor recibido: ${JSON.stringify(json.width)}).`,
    );
  }
  if (!isPosInt(json.height)) {
    errors.push(
      `"height" debe ser un entero positivo (valor recibido: ${JSON.stringify(json.height)}).`,
    );
  }
  if (!isPosInt(json.tilewidth)) {
    errors.push(
      `"tilewidth" debe ser un entero positivo (valor recibido: ${JSON.stringify(json.tilewidth)}).`,
    );
  }
  if (!isPosInt(json.tileheight)) {
    errors.push(
      `"tileheight" debe ser un entero positivo (valor recibido: ${JSON.stringify(json.tileheight)}).`,
    );
  }

  // ------------------------------------------------------------------
  // 4. layers: debe ser un array no vacío
  // ------------------------------------------------------------------
  if (!Array.isArray(json.layers) || json.layers.length === 0) {
    errors.push('"layers" debe ser un array no vacío con al menos las capas requeridas.');
    // Sin capas no podemos continuar con las siguientes validaciones
    return { ok: false, errors, zones };
  }

  // ------------------------------------------------------------------
  // 5. tilesets: debe haber al menos uno con name
  // ------------------------------------------------------------------
  if (!Array.isArray(json.tilesets) || json.tilesets.length === 0) {
    errors.push('"tilesets" debe contener al menos un tileset.');
  } else {
    json.tilesets.forEach((ts, idx) => {
      if (!ts || !ts.name || typeof ts.name !== 'string' || ts.name.trim() === '') {
        errors.push(`Tileset ${idx}: debe tener una propiedad "name" no vacía.`);
      }
    });
  }

  // ------------------------------------------------------------------
  // 6. Capas requeridas: suelo, colisión, zones
  // ------------------------------------------------------------------
  const tileLayers = json.layers.filter((l) => l && l.type === 'tilelayer');
  const objectLayers = json.layers.filter((l) => l && l.type === 'objectgroup');

  // Capa de suelo
  const floorLayer = tileLayers.find((l) => FLOOR_NAMES.includes(lower(l.name)));
  if (!floorLayer) {
    errors.push(
      `Falta la capa de suelo. Se esperaba un tilelayer con nombre "suelo" o "floor" (insensible a mayúsculas).`,
    );
  }

  // Capa de colisión
  const collisionLayer = tileLayers.find((l) => COLLISION_NAMES.includes(lower(l.name)));
  if (!collisionLayer) {
    errors.push(
      `Falta la capa de colisión. Se esperaba un tilelayer con nombre "colisión", "colision" o "collision" (insensible a mayúsculas).`,
    );
  }

  // Objectgroup "zones"
  const zonesLayer = objectLayers.find((l) => lower(l.name) === 'zones');
  if (!zonesLayer) {
    errors.push('Falta el objectgroup "zones". Agrega una capa de objetos con ese nombre exacto.');
  }

  // ------------------------------------------------------------------
  // 7. Coherencia de data en tilelayers embebidos (no chunked/infinite)
  //    Solo se verifica cuando `data` es un array (forma CSV embebida).
  //    Si `infinite === true` ya fue reportado arriba; aquí lo saltamos.
  // ------------------------------------------------------------------
  if (json.infinite !== true && isPosInt(json.width) && isPosInt(json.height)) {
    const expectedTiles = json.width * json.height;
    tileLayers.forEach((l) => {
      if (Array.isArray(l.data) && l.data.length !== expectedTiles) {
        errors.push(
          `Capa "${l.name}": el campo "data" tiene ${l.data.length} tiles pero se esperaban ${expectedTiles} (width × height = ${json.width} × ${json.height}).`,
        );
      }
    });
  }

  // ------------------------------------------------------------------
  // 8. Validar objetos de la capa zones
  // ------------------------------------------------------------------
  if (zonesLayer && Array.isArray(zonesLayer.objects)) {
    zones = validateZoneObjects(zonesLayer.objects, errors);
  } else if (zonesLayer) {
    errors.push('El objectgroup "zones" no contiene un array "objects" válido.');
  }

  return {
    ok: errors.length === 0,
    errors,
    zones,
  };
}
