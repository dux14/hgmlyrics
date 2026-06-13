/**
 * worldMapStore.test.js — Pruebas del descriptor del mapa activo.
 *
 * worldMapStore.js importa authStore.js (para las funciones admin), que a su
 * vez importa supabase.js (que llama createClient en el nivel de módulo).
 * Se mockean ambos para evitar el error "supabaseUrl is required" en CI.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/lib/supabase.js', () => ({ supabase: {} }));
vi.mock('../../src/lib/authStore.js', () => ({
  getSession: vi.fn(() => ({ access_token: '' })),
  isAdmin: vi.fn(() => false),
}));

import { getActiveMapDescriptor, loadActiveMap } from '../../src/world/worldMapStore.js';

// ---------------------------------------------------------------------------
// getActiveMapDescriptor
// ---------------------------------------------------------------------------

describe('getActiveMapDescriptor', () => {
  it('devuelve el descriptor del mapa dev con key, url y tileset', () => {
    const d = getActiveMapDescriptor();
    expect(d.key).toBeTruthy();
    expect(d.url).toBe('/world/dev-map.json');
    expect(d.tilesetKey).toBeTruthy();
    expect(d.tilesetUrl).toBe('/world/dev-tileset.png');
    expect(d.tilesetName).toBe('dev-tileset');
  });

  it('devuelve una copia nueva en cada llamada (no expone el estado interno)', () => {
    const a = getActiveMapDescriptor();
    const b = getActiveMapDescriptor();
    expect(a).not.toBe(b);
    a.url = 'mutado';
    expect(getActiveMapDescriptor().url).toBe('/world/dev-map.json');
  });
});

// ---------------------------------------------------------------------------
// loadActiveMap — helpers para construir un supabase fake
// ---------------------------------------------------------------------------

/**
 * Crea un cliente supabase falso que resuelve la consulta con el valor dado.
 * La cadena `.from().select().eq().maybeSingle()` devuelve una Promise.
 * @param {{ data: object|null, error: object|null }} result
 */
function makeSupabase(result) {
  const chainable = {
    select: () => chainable,
    eq: () => chainable,
    maybeSingle: () => Promise.resolve(result),
  };
  return { from: () => chainable };
}

/** Supabase fake que rechaza la promesa de maybeSingle (simula error de red). */
function makeSupabaseThrows() {
  const chainable = {
    select: () => chainable,
    eq: () => chainable,
    maybeSingle: () => Promise.reject(new Error('network error')),
  };
  return { from: () => chainable };
}

// ---------------------------------------------------------------------------
// loadActiveMap — tests
// ---------------------------------------------------------------------------

const SAMPLE_TILED_JSON = {
  tilesets: [{ name: 'mi-tileset' }],
  layers: [],
};

describe('loadActiveMap', () => {
  it('(a) devuelve descriptor DB cuando existe fila activa', async () => {
    const supabase = makeSupabase({
      data: {
        id: 'uuid-1',
        tiled_json: SAMPLE_TILED_JSON,
        tileset_url: 'https://storage.example.com/tileset.png',
      },
      error: null,
    });

    const desc = await loadActiveMap({ supabase });

    expect(desc.source).toBe('db');
    expect(desc.tiledJson).toBe(SAMPLE_TILED_JSON);
    expect(desc.tilesetUrl).toBe('https://storage.example.com/tileset.png');
    expect(desc.tilesetName).toBe('mi-tileset');
    expect(desc.key).toBe('world-map');
    expect(desc.tilesetKey).toBe('world-tileset');
    // El descriptor de DB no incluye url (no hay URL de fichero para el JSON inline).
    expect(desc.url).toBeUndefined();
  });

  it('(b) degrada al descriptor dev cuando no hay fila activa (data: null)', async () => {
    const supabase = makeSupabase({ data: null, error: null });

    const desc = await loadActiveMap({ supabase });

    expect(desc.source).toBe('dev');
    expect(desc.url).toBe('/world/dev-map.json');
    expect(desc.tilesetUrl).toBe('/world/dev-tileset.png');
    expect(desc.tilesetName).toBe('dev-tileset');
    // No hay tiledJson en el descriptor de dev.
    expect(desc.tiledJson).toBeUndefined();
  });

  it('(c) degrada al descriptor dev cuando la consulta devuelve error (no lanza)', async () => {
    const supabase = makeSupabase({ data: null, error: { message: 'permission denied' } });

    const desc = await loadActiveMap({ supabase });

    expect(desc.source).toBe('dev');
    expect(desc.url).toBe('/world/dev-map.json');
  });

  it('(d) degrada al descriptor dev cuando maybeSingle rechaza (no lanza)', async () => {
    const supabase = makeSupabaseThrows();

    const desc = await loadActiveMap({ supabase });

    expect(desc.source).toBe('dev');
    expect(desc.url).toBe('/world/dev-map.json');
  });
});
