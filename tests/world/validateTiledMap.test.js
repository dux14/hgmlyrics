import { describe, it, expect } from 'vitest';
import { validateTiledMap } from '../../api/_lib/validateTiledMap.js';

// ---------------------------------------------------------------------------
// Fixture base: mapa Tiled válido mínimo
// ---------------------------------------------------------------------------
const makeValidMap = () => ({
  width: 20,
  height: 15,
  tilewidth: 32,
  tileheight: 32,
  infinite: false,
  tilesets: [{ name: 'tileset-principal' }],
  layers: [
    {
      name: 'suelo',
      type: 'tilelayer',
      data: Array(20 * 15).fill(1),
    },
    {
      name: 'colision',
      type: 'tilelayer',
      data: Array(20 * 15).fill(0),
    },
    {
      name: 'zones',
      type: 'objectgroup',
      objects: [
        {
          x: 0,
          y: 0,
          width: 100,
          height: 80,
          properties: [
            { name: 'name', value: 'lobby' },
            { name: 'channelId', value: 'ch-lobby' },
          ],
        },
        {
          x: 100,
          y: 0,
          width: 200,
          height: 150,
          properties: [
            { name: 'name', value: 'escenario' },
            { name: 'channelId', value: 'ch-stage' },
          ],
        },
      ],
    },
  ],
});

// ---------------------------------------------------------------------------
// Caso válido
// ---------------------------------------------------------------------------
describe('validateTiledMap – caso válido', () => {
  it('devuelve ok:true, errors:[], y las zonas detectadas', () => {
    const result = validateTiledMap(makeValidMap());
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.zones).toEqual([
      { name: 'lobby', channelId: 'ch-lobby' },
      { name: 'escenario', channelId: 'ch-stage' },
    ]);
  });

  it('acepta nombres de capa con acento: "suelo"/"colisión" (utf-8)', () => {
    const map = makeValidMap();
    // Reemplaza el nombre de la capa de colisión por la versión acentuada
    map.layers[1].name = 'colisión';
    const result = validateTiledMap(map);
    expect(result.ok).toBe(true);
  });

  it('acepta nombre de capa "floor"/"collision" (inglés)', () => {
    const map = makeValidMap();
    map.layers[0].name = 'floor';
    map.layers[1].name = 'collision';
    const result = validateTiledMap(map);
    expect(result.ok).toBe(true);
  });

  it('acepta nombres de capa en mayúsculas (case-insensitive)', () => {
    const map = makeValidMap();
    map.layers[0].name = 'SUELO';
    map.layers[1].name = 'COLISION';
    const result = validateTiledMap(map);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Layer zones ausente
// ---------------------------------------------------------------------------
describe('validateTiledMap – capa zones ausente', () => {
  it('reporta error cuando no hay objectgroup llamado "zones"', () => {
    const map = makeValidMap();
    map.layers = map.layers.filter((l) => l.name !== 'zones');
    const result = validateTiledMap(map);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /zones/i.test(e))).toBe(true);
    expect(result.zones).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Layer de suelo ausente
// ---------------------------------------------------------------------------
describe('validateTiledMap – capa de suelo ausente', () => {
  it('reporta error cuando falta la capa de suelo/floor', () => {
    const map = makeValidMap();
    map.layers = map.layers.filter((l) => l.name !== 'suelo');
    const result = validateTiledMap(map);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /suelo|floor/i.test(e))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Layer de colisión ausente
// ---------------------------------------------------------------------------
describe('validateTiledMap – capa de colisión ausente', () => {
  it('reporta error cuando falta la capa de colisión/collision', () => {
    const map = makeValidMap();
    map.layers = map.layers.filter((l) => l.name !== 'colision');
    const result = validateTiledMap(map);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /colisi[oó]n|collision/i.test(e))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Zona sin channelId
// ---------------------------------------------------------------------------
describe('validateTiledMap – zona sin channelId', () => {
  it('reporta error cuando una zona no tiene channelId', () => {
    const map = makeValidMap();
    map.layers[2].objects[0].properties = [{ name: 'name', value: 'lobby' }];
    const result = validateTiledMap(map);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /channelId/i.test(e))).toBe(true);
  });

  it('reporta error cuando channelId está vacío', () => {
    const map = makeValidMap();
    map.layers[2].objects[0].properties = [
      { name: 'name', value: 'lobby' },
      { name: 'channelId', value: '' },
    ];
    const result = validateTiledMap(map);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /channelId/i.test(e))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Zona sin name
// ---------------------------------------------------------------------------
describe('validateTiledMap – zona sin name', () => {
  it('reporta error cuando una zona no tiene name', () => {
    const map = makeValidMap();
    map.layers[2].objects[1].properties = [{ name: 'channelId', value: 'ch-stage' }];
    const result = validateTiledMap(map);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /\bname\b/i.test(e))).toBe(true);
  });

  it('reporta error cuando name está vacío', () => {
    const map = makeValidMap();
    map.layers[2].objects[1].properties = [
      { name: 'name', value: '' },
      { name: 'channelId', value: 'ch-stage' },
    ];
    const result = validateTiledMap(map);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /\bname\b/i.test(e))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// channelId duplicado
// ---------------------------------------------------------------------------
describe('validateTiledMap – channelId duplicado', () => {
  it('reporta error cuando dos zonas comparten el mismo channelId', () => {
    const map = makeValidMap();
    map.layers[2].objects[1].properties = [
      { name: 'name', value: 'escenario' },
      { name: 'channelId', value: 'ch-lobby' }, // duplicado
    ];
    const result = validateTiledMap(map);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /duplicado/i.test(e) && /ch-lobby/.test(e))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Múltiples errores a la vez (validación acumulativa)
// ---------------------------------------------------------------------------
describe('validateTiledMap – acumulación de errores', () => {
  it('reporta todos los errores de zona de una sola pasada', () => {
    const map = makeValidMap();
    // zona 0: sin channelId; zona 1: sin name
    map.layers[2].objects[0].properties = [{ name: 'name', value: 'lobby' }];
    map.layers[2].objects[1].properties = [{ name: 'channelId', value: 'ch-stage' }];
    const result = validateTiledMap(map);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Dimensiones incoherentes
// ---------------------------------------------------------------------------
describe('validateTiledMap – dimensiones incoherentes', () => {
  it('reporta error cuando width no es entero positivo', () => {
    const map = makeValidMap();
    map.width = 0;
    const result = validateTiledMap(map);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /width/i.test(e))).toBe(true);
  });

  it('reporta error cuando height es negativo', () => {
    const map = makeValidMap();
    map.height = -5;
    const result = validateTiledMap(map);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /height/i.test(e))).toBe(true);
  });

  it('reporta error cuando tilewidth es no-número', () => {
    const map = makeValidMap();
    map.tilewidth = 'treinta y dos';
    const result = validateTiledMap(map);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /tilewidth/i.test(e))).toBe(true);
  });

  it('reporta error cuando tileheight es cero', () => {
    const map = makeValidMap();
    map.tileheight = 0;
    const result = validateTiledMap(map);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /tileheight/i.test(e))).toBe(true);
  });

  it('reporta error cuando layers está vacío', () => {
    const map = makeValidMap();
    map.layers = [];
    const result = validateTiledMap(map);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /layers/i.test(e))).toBe(true);
  });

  it('reporta error cuando tilesets está vacío', () => {
    const map = makeValidMap();
    map.tilesets = [];
    const result = validateTiledMap(map);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /tilesets?/i.test(e))).toBe(true);
  });

  it('reporta error cuando un tileset no tiene name', () => {
    const map = makeValidMap();
    map.tilesets = [{}];
    const result = validateTiledMap(map);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /tileset/i.test(e))).toBe(true);
  });

  it('reporta error cuando el data de un tilelayer no coincide con width*height', () => {
    const map = makeValidMap();
    // suelo tiene 20*15=300 tiles; poner solo 10
    map.layers[0].data = Array(10).fill(1);
    const result = validateTiledMap(map);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /data|tiles/i.test(e))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mapa infinito (no soportado)
// ---------------------------------------------------------------------------
describe('validateTiledMap – mapa infinito', () => {
  it('reporta error cuando infinite === true', () => {
    const map = makeValidMap();
    map.infinite = true;
    const result = validateTiledMap(map);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /infinito|infinite/i.test(e))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Entradas basura (robustez)
// ---------------------------------------------------------------------------
describe('validateTiledMap – entradas basura', () => {
  it('null → ok:false sin lanzar', () => {
    const result = validateTiledMap(null);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.zones).toEqual([]);
  });

  it('undefined → ok:false sin lanzar', () => {
    const result = validateTiledMap(undefined);
    expect(result.ok).toBe(false);
    expect(result.zones).toEqual([]);
  });

  it('string → ok:false sin lanzar', () => {
    const result = validateTiledMap('no soy un mapa');
    expect(result.ok).toBe(false);
    expect(result.zones).toEqual([]);
  });

  it('número → ok:false sin lanzar', () => {
    const result = validateTiledMap(42);
    expect(result.ok).toBe(false);
    expect(result.zones).toEqual([]);
  });

  it('objeto vacío → ok:false sin lanzar', () => {
    const result = validateTiledMap({});
    expect(result.ok).toBe(false);
    expect(result.zones).toEqual([]);
  });

  it('array → ok:false sin lanzar', () => {
    const result = validateTiledMap([]);
    expect(result.ok).toBe(false);
    expect(result.zones).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// properties no-array en zona (seguridad: no debe lanzar TypeError)
// ---------------------------------------------------------------------------
describe('validateTiledMap – properties no-array en zona', () => {
  it('properties como string corrupto → ok:false sin lanzar', () => {
    const map = makeValidMap();
    // Sustituir la primera zona con properties siendo un string (no array)
    map.layers[2].objects[0] = { x: 0, y: 0, width: 100, height: 80, properties: 'corrupted' };
    let result;
    expect(() => {
      result = validateTiledMap(map);
    }).not.toThrow();
    expect(result.ok).toBe(false);
    // Debe reportar errores de name y channelId faltantes en esa zona
    expect(result.errors.some((e) => /name/i.test(e) || /channelId/i.test(e))).toBe(true);
  });

  it('properties como número → ok:false sin lanzar', () => {
    const map = makeValidMap();
    map.layers[2].objects[0] = { x: 0, y: 0, width: 100, height: 80, properties: 42 };
    let result;
    expect(() => {
      result = validateTiledMap(map);
    }).not.toThrow();
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /name/i.test(e) || /channelId/i.test(e))).toBe(true);
  });
});
