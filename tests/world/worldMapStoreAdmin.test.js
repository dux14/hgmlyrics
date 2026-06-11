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

/**
 * Crea un fetch global para la secuencia: primera llamada = respuesta del upload,
 * segunda llamada = respuesta del POST create.
 */
function mockFetchSequence(...responses) {
  let i = 0;
  return vi.fn(() => {
    const r = responses[i] ?? responses[responses.length - 1];
    i++;
    return Promise.resolve(r);
  });
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

  it('sube el tileset via /api/admin/tileset-upload y llama POST /api/admin/world-map con create', async () => {
    // Primera llamada: POST /api/admin/tileset-upload → URL del tileset
    // Segunda llamada: POST /api/admin/world-map → respuesta del create
    const uploadUrl = 'https://storage.example.com/world-maps/mi-mapa-123/tileset.png';
    const responseBody = {
      map: { id: 'new-uuid', name: 'Mi Mapa', isActive: false, updatedAt: '2024-01-01T00:00:00Z' },
      zones: [{ name: 'Sala', channelId: 'ch-sala' }],
    };
    globalThis.fetch = mockFetchSequence(
      { ok: true, status: 200, json: () => Promise.resolve({ url: uploadUrl }) },
      { ok: true, status: 201, json: () => Promise.resolve(responseBody) },
    );

    const tilesetBlob = new Blob(['PNG_DATA'], { type: 'image/png' });
    const result = await saveMap({
      supabase: {},
      name: 'Mi Mapa',
      tiledJson: VALID_TILED_JSON,
      tilesetBlob,
    });

    // Primera llamada debe ser al endpoint de upload
    expect(fetch).toHaveBeenCalledTimes(2);
    const [uploadUrl1, uploadOpts] = fetch.mock.calls[0];
    expect(uploadUrl1).toBe('/api/admin/tileset-upload');
    expect(uploadOpts.method).toBe('POST');
    // Segunda llamada al endpoint de create
    const [createUrl, createOpts] = fetch.mock.calls[1];
    expect(createUrl).toBe('/api/admin/world-map');
    expect(createOpts.method).toBe('POST');
    const body = JSON.parse(createOpts.body);
    expect(body.action).toBe('create');
    expect(body.name).toBe('Mi Mapa');
    expect(body.tilesetUrl).toBe(uploadUrl);

    expect(result.map.name).toBe('Mi Mapa');
    expect(result.zones).toHaveLength(1);
  });

  it('lanza si /api/admin/tileset-upload falla (no llega al fetch POST create)', async () => {
    globalThis.fetch = mockFetchSequence({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'storage_error' }),
    });
    const tilesetBlob = new Blob(['data'], { type: 'image/png' });

    await expect(
      saveMap({ supabase: {}, name: 'X', tiledJson: VALID_TILED_JSON, tilesetBlob }),
    ).rejects.toThrow('storage_error');
    // Solo se llama al endpoint de upload, no al de create
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('lanza con errors array si el servidor de create responde 400 con errors', async () => {
    const uploadUrl = 'https://storage.example.com/world-maps/x/tileset.png';
    globalThis.fetch = mockFetchSequence(
      { ok: true, status: 200, json: () => Promise.resolve({ url: uploadUrl }) },
      { ok: false, status: 400, json: () => Promise.resolve({ errors: ['Error A', 'Error B'] }) },
    );
    const tilesetBlob = new Blob(['data'], { type: 'image/png' });

    const err = await saveMap({
      supabase: {},
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
