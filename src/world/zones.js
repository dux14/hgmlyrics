/**
 * Lógica pura de zonas del mapa (formato Tiled JSON).
 */

/**
 * Lee el object layer llamado "zones" de un mapa Tiled y devuelve zonas normalizadas.
 *
 * @param {object} mapJson - Mapa en formato Tiled JSON.
 * @returns {{ name: string, channelId: string, rect: {x:number, y:number, w:number, h:number} }[]}
 * @throws {Error} Si falta name o channelId en alguna zona, o si channelId está duplicado.
 */
export function parseZones(mapJson) {
  const layer = (mapJson?.layers ?? []).find((l) => l.name === 'zones' && l.type === 'objectgroup');
  if (!layer) return [];

  const seen = new Set();
  return layer.objects.map((obj, idx) => {
    const props = Object.fromEntries((obj.properties ?? []).map((p) => [p.name, p.value]));

    if (!props.name) {
      throw new Error(`Zona ${idx}: propiedad "name" requerida`);
    }
    if (!props.channelId) {
      throw new Error(`Zona "${props.name}": propiedad "channelId" requerida`);
    }
    if (seen.has(props.channelId)) {
      throw new Error(`channelId duplicado: "${props.channelId}"`);
    }
    seen.add(props.channelId);

    return {
      name: props.name,
      channelId: props.channelId,
      rect: { x: obj.x, y: obj.y, w: obj.width, h: obj.height },
    };
  });
}

/**
 * Devuelve la primera zona cuyo rect contiene el punto (x, y), o null si ninguna.
 * El rango es semi-abierto: [rx, rx+w) × [ry, ry+h).
 *
 * @param {{ rect: {x:number, y:number, w:number, h:number} }[]} zones
 * @param {number} x
 * @param {number} y
 * @returns {object|null}
 */
export function zoneAt(zones, x, y) {
  for (const zone of zones) {
    const { x: rx, y: ry, w, h } = zone.rect;
    if (x >= rx && x < rx + w && y >= ry && y < ry + h) return zone;
  }
  return null;
}
