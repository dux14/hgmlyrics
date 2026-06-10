import { describe, it, expect } from 'vitest';
import { parseZones, zoneAt } from '../../src/world/zones.js';

// Fixture en formato Tiled JSON con dos zonas
const MAP_JSON = {
  layers: [
    {
      name: 'tiles',
      type: 'tilelayer',
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
            { name: 'name', value: 'stage' },
            { name: 'channelId', value: 'ch-stage' },
          ],
        },
      ],
    },
  ],
};

describe('parseZones', () => {
  it('extrae name, channelId y rect desde el layer zones', () => {
    const zones = parseZones(MAP_JSON);
    expect(zones).toHaveLength(2);

    expect(zones[0]).toEqual({
      name: 'lobby',
      channelId: 'ch-lobby',
      rect: { x: 0, y: 0, w: 100, h: 80 },
    });
    expect(zones[1]).toEqual({
      name: 'stage',
      channelId: 'ch-stage',
      rect: { x: 100, y: 0, w: 200, h: 150 },
    });
  });

  it('lanza si channelId falta en una zona', () => {
    const map = {
      layers: [
        {
          name: 'zones',
          type: 'objectgroup',
          objects: [
            {
              x: 0,
              y: 0,
              width: 50,
              height: 50,
              properties: [{ name: 'name', value: 'sin-canal' }],
            },
          ],
        },
      ],
    };
    expect(() => parseZones(map)).toThrow(/channelId/);
  });

  it('lanza si name falta en una zona', () => {
    const map = {
      layers: [
        {
          name: 'zones',
          type: 'objectgroup',
          objects: [
            {
              x: 0,
              y: 0,
              width: 50,
              height: 50,
              properties: [{ name: 'channelId', value: 'ch-x' }],
            },
          ],
        },
      ],
    };
    expect(() => parseZones(map)).toThrow(/name/);
  });

  it('lanza si channelId está duplicado', () => {
    const map = {
      layers: [
        {
          name: 'zones',
          type: 'objectgroup',
          objects: [
            {
              x: 0,
              y: 0,
              width: 50,
              height: 50,
              properties: [
                { name: 'name', value: 'zona-a' },
                { name: 'channelId', value: 'ch-dup' },
              ],
            },
            {
              x: 100,
              y: 0,
              width: 50,
              height: 50,
              properties: [
                { name: 'name', value: 'zona-b' },
                { name: 'channelId', value: 'ch-dup' },
              ],
            },
          ],
        },
      ],
    };
    expect(() => parseZones(map)).toThrow(/duplicado/i);
  });
});

describe('zoneAt', () => {
  const zones = parseZones(MAP_JSON);

  it('devuelve la zona correcta para un punto interior', () => {
    // Punto dentro de lobby (0,0,100,80)
    expect(zoneAt(zones, 50, 40)).toMatchObject({ name: 'lobby' });
    // Punto dentro de stage (100,0,200,150)
    expect(zoneAt(zones, 200, 75)).toMatchObject({ name: 'stage' });
  });

  it('devuelve null para un punto fuera de toda zona', () => {
    expect(zoneAt(zones, 400, 400)).toBeNull();
  });

  it('incluye el borde superior-izquierdo (x=rx, y=ry)', () => {
    expect(zoneAt(zones, 0, 0)).toMatchObject({ name: 'lobby' });
  });

  it('excluye el borde derecho (x=rx+w)', () => {
    // lobby termina en x=100; x=100 pertenece a stage
    expect(zoneAt(zones, 100, 40)).toMatchObject({ name: 'stage' });
  });

  it('excluye el borde inferior (y=ry+h)', () => {
    // lobby termina en y=80
    expect(zoneAt(zones, 50, 80)).toBeNull();
  });
});
