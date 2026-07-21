/**
 * ingestCancionero.test.js — Task A6, ingesta del cancionero PDF.
 * Funciones puras (_ingestLib.mjs) se testean directo, sin mocks. El flujo
 * del script (scripts/ingest-cancionero.mjs) mockea @anthropic-ai/sdk,
 * postgres y fs/promises, mismo patron que tests/apiPipelineCleanup.test.js.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseExtraction,
  matchSongs,
  buildUpserts,
  EXTRACTION_SCHEMA,
} from '../scripts/_ingestLib.mjs';

// ── Funciones puras ──────────────────────────────────────────────────────

describe('parseExtraction', () => {
  it('parsea un JSON válido y devuelve las canciones', () => {
    const text = JSON.stringify({
      canciones: [{ titulo: 'Sion', secciones: [{ lineas: [{ texto: 'primera linea' }] }] }],
    });
    const canciones = parseExtraction(text);
    expect(canciones).toHaveLength(1);
    expect(canciones[0].titulo).toBe('Sion');
  });

  it('rechaza JSON inválido', () => {
    expect(() => parseExtraction('{no es json')).toThrow(/JSON válido/);
  });

  it('rechaza cancion sin lineas con texto', () => {
    const text = JSON.stringify({
      canciones: [{ titulo: 'Sion', secciones: [{ lineas: [{ texto: '' }] }] }],
    });
    expect(() => parseExtraction(text)).toThrow(/texto/);
  });

  it('exige el campo canciones como array', () => {
    expect(() => parseExtraction(JSON.stringify({}))).toThrow(/canciones/);
  });
});

describe('matchSongs', () => {
  const songsFromDb = [
    { id: 'song-sion', title: 'Sion' },
    { id: 'song-alabanza', title: 'Alabanza al Rey' },
  ];

  it('matchea una cancion con titulo casi identico y deja la otra sin match', () => {
    const canciones = [
      { titulo: 'Sion', secciones: [] },
      { titulo: 'Cancion que no existe en la DB', secciones: [] },
    ];
    const { linked, unlinked } = matchSongs(canciones, songsFromDb);
    expect(linked).toHaveLength(1);
    expect(linked[0].songId).toBe('song-sion');
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0].cancion.titulo).toBe('Cancion que no existe en la DB');
  });

  it('no inventa song_id para titulos sin match confiable', () => {
    const { linked, unlinked } = matchSongs(
      [{ titulo: 'Totalmente distinto xyz', secciones: [] }],
      songsFromDb,
    );
    expect(linked).toHaveLength(0);
    expect(unlinked).toHaveLength(1);
  });
});

describe('buildUpserts', () => {
  it('arma el content con el shape que espera el pipeline (secciones[].lineas[].texto)', () => {
    const linked = [
      {
        songId: 'song-sion',
        cancion: {
          titulo: 'Sion',
          secciones: [{ tipo: 'estrofa', lineas: [{ texto: 'primera linea', acordes: 'Do Sol' }] }],
        },
      },
    ];
    const upserts = buildUpserts(linked);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].songId).toBe('song-sion');
    expect(upserts[0].content.secciones[0].lineas[0]).toEqual({
      texto: 'primera linea',
      acordes: 'Do Sol',
    });
  });

  it('omite acordes cuando no vienen en la extracción', () => {
    const linked = [
      {
        songId: 'song-x',
        cancion: { titulo: 'X', secciones: [{ lineas: [{ texto: 'linea' }] }] },
      },
    ];
    const [{ content }] = buildUpserts(linked);
    expect(content.secciones[0].lineas[0]).toEqual({ texto: 'linea' });
  });
});

describe('EXTRACTION_SCHEMA', () => {
  it('exige secciones[].lineas[].texto y no permite propiedades extra', () => {
    expect(EXTRACTION_SCHEMA.properties.canciones.items.required).toContain('secciones');
    const lineaSchema =
      EXTRACTION_SCHEMA.properties.canciones.items.properties.secciones.items.properties.lineas
        .items;
    expect(lineaSchema.required).toContain('texto');
    expect(lineaSchema.additionalProperties).toBe(false);
  });
});

// ── Flujo del script (mocks) ─────────────────────────────────────────────

const mockFinalMessage = vi.fn();
const mockStream = vi.fn(() => ({ finalMessage: mockFinalMessage }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    constructor() {
      this.messages = { stream: mockStream };
    }
  },
}));

const topLevelResponses = [];
function sqlMock(strings) {
  if (!strings?.raw) return strings;
  return Promise.resolve(topLevelResponses.shift() ?? []);
}
sqlMock.json = (v) => v;
sqlMock.end = vi.fn().mockResolvedValue(undefined);
vi.mock('postgres', () => ({ default: () => sqlMock }));

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
vi.mock('node:fs/promises', () => {
  const readFile = (...args) => mockReadFile(...args);
  const writeFile = (...args) => mockWriteFile(...args);
  return { readFile, writeFile, default: { readFile, writeFile } };
});

const mockExistsSync = vi.fn();
vi.mock('node:fs', () => {
  const existsSync = (...args) => mockExistsSync(...args);
  return { existsSync, default: { existsSync } };
});

beforeEach(() => {
  topLevelResponses.length = 0;
  mockFinalMessage.mockReset();
  mockStream.mockClear();
  mockReadFile.mockReset();
  mockWriteFile.mockClear();
  mockExistsSync.mockReset().mockReturnValue(true);
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  process.env.DATABASE_URL = 'postgresql://test';
});

describe('flujo dry-run (mocks de SDK + postgres + fs)', () => {
  it('sin ANTHROPIC_API_KEY falla con mensaje claro y no llama a la API', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { runDryRun } = await import('../scripts/ingest-cancionero.mjs');
    await expect(runDryRun()).rejects.toThrow(/ANTHROPIC_API_KEY/);
    expect(mockStream).not.toHaveBeenCalled();
  });

  it('sin DATABASE_URL falla con mensaje claro y no llama a la API', async () => {
    delete process.env.DATABASE_URL;
    const { runDryRun } = await import('../scripts/ingest-cancionero.mjs');
    await expect(runDryRun()).rejects.toThrow(/DATABASE_URL/);
    expect(mockStream).not.toHaveBeenCalled();
  });

  it('si no existe el PDF, falla con mensaje claro', async () => {
    mockExistsSync.mockReturnValue(false);
    const { runDryRun } = await import('../scripts/ingest-cancionero.mjs');
    await expect(runDryRun()).rejects.toThrow(/PDF/);
  });

  it('si la respuesta se trunca por max_tokens, falla con mensaje claro', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('%PDF-fake%'));
    mockFinalMessage.mockResolvedValue({ stop_reason: 'max_tokens', content: [] });
    const { runDryRun } = await import('../scripts/ingest-cancionero.mjs');
    await expect(runDryRun()).rejects.toThrow(/max_tokens/);
  });

  it('extrae, matchea contra songs y escribe el JSON de revisión', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('%PDF-fake%'));
    mockFinalMessage.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            canciones: [
              { titulo: 'Sion', secciones: [{ lineas: [{ texto: 'primera linea' }] }] },
              { titulo: 'Sin match en DB', secciones: [{ lineas: [{ texto: 'otra' }] }] },
            ],
          }),
        },
      ],
    });
    topLevelResponses.push([{ id: 'song-sion', title: 'Sion' }]);

    const { runDryRun } = await import('../scripts/ingest-cancionero.mjs');
    await runDryRun();

    expect(mockStream).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-sonnet-5' }));
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [, jsonWritten] = mockWriteFile.mock.calls[0];
    const parsed = JSON.parse(jsonWritten);
    expect(parsed.linked).toHaveLength(1);
    expect(parsed.linked[0].songId).toBe('song-sion');
    expect(parsed.unlinked).toHaveLength(1);
    expect(parsed.unlinked[0].titulo).toBe('Sin match en DB');
  });
});

describe('flujo --commit (mocks de postgres + fs)', () => {
  it('hace upsert solo de las canciones ya matcheadas en el JSON revisado', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        linked: [
          {
            songId: 'song-sion',
            score: 0.95,
            cancion: {
              titulo: 'Sion',
              secciones: [{ lineas: [{ texto: 'primera linea' }] }],
            },
          },
        ],
      }),
    );
    topLevelResponses.push([]); // respuesta del INSERT ... ON CONFLICT

    const { runCommit } = await import('../scripts/ingest-cancionero.mjs');
    await runCommit();

    expect(topLevelResponses).toHaveLength(0); // se consumió el upsert
  });

  it('si no existe el JSON de revisión, falla pidiendo correr el dry-run primero', async () => {
    mockExistsSync.mockReturnValue(false);
    const { runCommit } = await import('../scripts/ingest-cancionero.mjs');
    await expect(runCommit()).rejects.toThrow(/dry-run/);
  });

  it('sin DATABASE_URL falla con mensaje claro', async () => {
    delete process.env.DATABASE_URL;
    const { runCommit } = await import('../scripts/ingest-cancionero.mjs');
    await expect(runCommit()).rejects.toThrow(/DATABASE_URL/);
  });
});
