/**
 * worldMapStoreAdmin.test.js — Pruebas de las funciones admin del worldMapStore.
 *
 * Mockea:
 *   - fetch global (para los endpoints /api/admin/world-map)
 *   - ../src/lib/authStore.js → getSession (para la cabecera de autorización)
 *   - ../src/lib/supabase.js  (no se usa aquí; importado por el módulo pero
 *     no necesario para las funciones admin que reciben supabase por parámetro)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// -- Mocks de módulos con dependencias de entorno ----------------------------

vi.mock('../../src/lib/supabase.js', () => ({ supabase: {} }));
vi.mock('../../src/lib/authStore.js', () => ({
  getSession: vi.fn(() => ({ access_token: 'test-token' })),
  isAdmin: vi.fn(() => true),
}));

const { listMaps, saveMap, activate } = await import('../../src/world/worldMapStore.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Crea un fetch global que responde con el JSON/status dado. */
function mockFetch(body, status = 200) {
  return vi.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

/** Supabase fake con Storage upload que siempre tiene éxito. */
function makeSupabaseStorage(publicUrl = 'https://storage.example.com/world-maps/map/tileset.png') {
  const fromObj = {
    upload: vi.fn(() => Promise.resolve({ error: null })),
    getPublicUrl: vi.fn(() => ({ data: { publicUrl } })),
  };
  return { storage: { from: vi.fn(() => fromObj) }, _fromObj: fromObj };
}

// ---------------------------------------------------------------------------
// listMaps
// ---------------------------------------------------------------------------

describe('listMaps', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('llama GET /api/admin/world-map con cabecera Authorization y retorna maps', async () => {
    const maps = [
      { id: 'uuid-1', name: 'Mapa A', isActive: true, updatedAt: '2024-01-01T00:00:00Z' },
    ];
    globalThis.fetch = mockFetch({ maps });

    const result = await listMaps({});

    expect(fetch).toHaveBeenCalledOnce();
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('/api/admin/world-map');
    expect(opts.headers.Authorization).toBe('Bearer test-token');
    expect(result).toEqual(maps);
  });

  it('lanza un error con status cuando la respuesta no es ok', async () => {
    globalThis.fetch = mockFetch({ error: 'Forbidden' }, 403);

    await expect(listMaps({})).rejects.toMatchObject({ message: 'Forbidden', status: 403 });
  });
});

// ---------------------------------------------------------------------------
// saveMap
// ---------------------------------------------------------------------------

describe('saveMap', () => {
  const VALID_TILED_JSON = {
    width: 10,
    height: 10,
    tilewidth: 32,
    tileheight: 32,
    layers: [
      { type: 'tilelayer', name: 'suelo', data: Array(100).fill(1) },
      { type: 'tilelayer', name: 'collision', data: Array(100).fill(0) },
      {
        type: 'objectgroup',
        name: 'zones',
        objects: [
          {
            properties: [
              { name: 'name', value: 'Sala' },
              { name: 'channelId', value: 'ch-sala' },
            ],
          },
        ],
      },
    ],
    tilesets: [{ name: 'world-tileset' }],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sube el tileset a Storage y llama POST /api/admin/world-map con create', async () => {
    const fakeSupabase = makeSupabaseStorage();
    const responseBody = {
      map: { id: 'new-uuid', name: 'Mi Mapa', isActive: false, updatedAt: '2024-01-01T00:00:00Z' },
      zones: [{ name: 'Sala', channelId: 'ch-sala' }],
    };
    globalThis.fetch = mockFetch(responseBody, 201);

    const tilesetBlob = new Blob(['PNG_DATA'], { type: 'image/png' });
    const result = await saveMap({
      supabase: fakeSupabase,
      name: 'Mi Mapa',
      tiledJson: VALID_TILED_JSON,
      tilesetBlob,
    });

    // Verificar que se llamó a Storage.upload con el bucket correcto
    expect(fakeSupabase.storage.from).toHaveBeenCalledWith('world-maps');
    expect(fakeSupabase._fromObj.upload).toHaveBeenCalledOnce();
    const [storagePath] = fakeSupabase._fromObj.upload.mock.calls[0];
    expect(storagePath).toMatch(/^mi-mapa-\d+\/tileset\.png$/);

    // Verificar el fetch POST
    expect(fetch).toHaveBeenCalledOnce();
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('/api/admin/world-map');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.action).toBe('create');
    expect(body.name).toBe('Mi Mapa');
    expect(body.tilesetUrl).toBe('https://storage.example.com/world-maps/map/tileset.png');

    expect(result.map.name).toBe('Mi Mapa');
    expect(result.zones).toHaveLength(1);
  });

  it('lanza si Storage upload falla (no llega al fetch POST)', async () => {
    const fakeSupabase = {
      storage: {
        from: () => ({
          upload: vi.fn(() => Promise.resolve({ error: { message: 'storage_error' } })),
          getPublicUrl: vi.fn(),
        }),
      },
    };
    globalThis.fetch = vi.fn();
    const tilesetBlob = new Blob(['data'], { type: 'image/png' });

    await expect(
      saveMap({ supabase: fakeSupabase, name: 'X', tiledJson: VALID_TILED_JSON, tilesetBlob }),
    ).rejects.toThrow('storage_error');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lanza con errors array si el servidor responde 400 con errors', async () => {
    const fakeSupabase = makeSupabaseStorage();
    globalThis.fetch = mockFetch({ errors: ['Error A', 'Error B'] }, 400);
    const tilesetBlob = new Blob(['data'], { type: 'image/png' });

    const err = await saveMap({
      supabase: fakeSupabase,
      name: 'X',
      tiledJson: VALID_TILED_JSON,
      tilesetBlob,
    }).catch((e) => e);

    expect(err.status).toBe(400);
    expect(err.errors).toEqual(['Error A', 'Error B']);
  });
});

// ---------------------------------------------------------------------------
// activate
// ---------------------------------------------------------------------------

describe('activate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('llama POST /api/admin/world-map con action:activate e id', async () => {
    const map = { id: 'uuid-1', name: 'Mapa A', isActive: true, updatedAt: '2024-01-01T00:00:00Z' };
    globalThis.fetch = mockFetch({ map }, 200);

    const result = await activate({ id: 'uuid-1' });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('/api/admin/world-map');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.action).toBe('activate');
    expect(body.id).toBe('uuid-1');
    expect(result.map.isActive).toBe(true);
  });

  it('lanza si el servidor responde con error', async () => {
    globalThis.fetch = mockFetch({ error: 'Mapa no encontrado.' }, 404);

    await expect(activate({ id: 'bad-uuid' })).rejects.toMatchObject({
      message: 'Mapa no encontrado.',
      status: 404,
    });
  });
});
