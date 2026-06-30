import { describe, it, expect } from 'vitest';
import { GO_TO_TILES, activeTile } from '../src/components/GoToSheet.js';

describe('GO_TO_TILES', () => {
  it('tiene 6 tiles con id/label/route/iconKey', () => {
    expect(GO_TO_TILES).toHaveLength(6);
    for (const t of GO_TO_TILES) {
      expect(t).toEqual(expect.objectContaining({
        id: expect.any(String), label: expect.any(String),
        route: expect.any(String), iconKey: expect.any(String),
      }));
    }
  });
  it('orden y rutas esperadas', () => {
    expect(GO_TO_TILES.map((t) => t.route)).toEqual([
      '/buscar', '/lista/nueva', '/oracion', '/favoritos', '/voces', '/mundo',
    ]);
  });
});

describe('activeTile', () => {
  it('match exacto', () => expect(activeTile('/oracion')).toBe('oracion'));
  it('ignora querystring', () => expect(activeTile('/favoritos?x=1')).toBe('favoritos'));
  it('match por prefijo de subruta', () => expect(activeTile('/lista/nueva')).toBe('listas'));
  it('ruta sin tile → null', () => expect(activeTile('/song/1')).toBeNull());
});
