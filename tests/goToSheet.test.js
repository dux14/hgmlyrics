import { describe, it, expect } from 'vitest';
import { GO_TO_TILES, activeTile } from '../src/components/GoToSheet.js';

describe('GO_TO_TILES', () => {
  it('tiene 6 tiles', () => {
    expect(GO_TO_TILES).toHaveLength(6);
  });
  it('cada tile tiene id, label e iconKey', () => {
    for (const t of GO_TO_TILES) {
      expect(t).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          label: expect.any(String),
          iconKey: expect.any(String),
        }),
      );
    }
  });
  it('los primeros 5 tiles tienen route; el tile cache tiene action', () => {
    const withRoute = GO_TO_TILES.filter((t) => t.route);
    const withAction = GO_TO_TILES.filter((t) => t.action);
    expect(withRoute).toHaveLength(5);
    expect(withAction).toHaveLength(1);
    expect(withAction[0].id).toBe('cache');
    expect(withAction[0].action).toBe('clearCache');
  });
  it('orden de rutas de los tiles con route', () => {
    const routes = GO_TO_TILES.filter((t) => t.route).map((t) => t.route);
    expect(routes).toEqual(['/albumes', '/listas', '/oracion', '/favoritos', '/voces']);
  });
  it('tile "Limpiar caché" en lugar de "Mundo"', () => {
    const ids = GO_TO_TILES.map((t) => t.id);
    expect(ids).not.toContain('mundo');
    expect(ids).toContain('cache');
    const cacheTile = GO_TO_TILES.find((t) => t.id === 'cache');
    expect(cacheTile.label).toBe('Limpiar caché');
  });
});

describe('activeTile', () => {
  it('match exacto', () => expect(activeTile('/oracion')).toBe('oracion'));
  it('ignora querystring', () => expect(activeTile('/favoritos?x=1')).toBe('favoritos'));
  it('match por prefijo de subruta', () => expect(activeTile('/listas/nueva')).toBe('listas'));
  it('ruta sin tile → null', () => expect(activeTile('/song/1')).toBeNull());
  it('/mundo ya no tiene tile → null', () => expect(activeTile('/mundo')).toBeNull());
});

describe('GO_TO_TILES rutas y colores', () => {
  it('álbumes apunta a /albumes y listas a /listas', () => {
    const albumes = GO_TO_TILES.find((t) => t.id === 'albumes');
    const listas = GO_TO_TILES.find((t) => t.id === 'listas');
    expect(albumes.route).toBe('/albumes');
    expect(listas.route).toBe('/listas');
  });

  it('cada tile define un color de identidad', () => {
    for (const t of GO_TO_TILES) {
      expect(typeof t.color).toBe('string');
      expect(t.color.startsWith('--color') || t.color.startsWith('var(')).toBe(true);
    }
  });

  it('activeTile resuelve las nuevas rutas', () => {
    expect(activeTile('/albumes')).toBe('albumes');
    expect(activeTile('/listas')).toBe('listas');
    expect(activeTile('/voces')).toBe('voces');
  });
});
