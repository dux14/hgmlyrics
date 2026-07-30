// tests/pipelineSongbookSync.test.js
import { describe, it, expect, vi } from 'vitest';

// songbookSync.js importa projectCanonicalLines de align.js, que a su vez
// importa db.js/storage.js (exigen env vars en runtime real); se mockean
// igual que en tests/projectLines.test.js para poder importarlo sin
// credenciales — songbookDiverged solo usa la proyección pura.
vi.mock('../api/_lib/db.js', () => ({ default: () => Promise.resolve([]) }));
vi.mock('../api/_lib/storage.js', () => ({
  signSongAudioDownload: vi.fn(),
}));
const { propagateSongbookText, songbookDiverged } =
  await import('../api/_lib/pipeline/songbookSync.js');

function mkLine(text, overrides = {}) {
  return {
    text,
    startMs: 0,
    endMs: 0,
    words: [],
    confidence: null,
    vocalization: false,
    breath: false,
    manualStartMs: null,
    ...overrides,
  };
}
function mkSection(lines) {
  return { type: 'verse', label: null, startMs: 0, endMs: 0, lines };
}

describe('propagateSongbookText', () => {
  it('propaga el texto 1:1 conservando startMs/endMs/manualStartMs/vocalization/confidence', () => {
    const storeSections = [
      mkSection([
        mkLine('hola mundo', {
          startMs: 100,
          endMs: 900,
          manualStartMs: 150,
          vocalization: true,
          confidence: 0.9,
        }),
      ]),
      mkSection([mkLine('linea dos', { startMs: 1000, endMs: 1900 })]),
    ];
    const canonicalLines = [
      { i: 0, text: 'holá mundo' },
      { i: 1, text: 'línea dos' },
    ];
    const result = propagateSongbookText(storeSections, canonicalLines);
    expect(result).not.toBeNull();
    expect(result[0].lines[0]).toMatchObject({
      text: 'holá mundo',
      startMs: 100,
      endMs: 900,
      manualStartMs: 150,
      vocalization: true,
      confidence: 0.9,
    });
    expect(result[1].lines[0]).toMatchObject({ text: 'línea dos', startMs: 1000, endMs: 1900 });
  });

  it('largos distintos entre el store y las lineas canonicas: devuelve null', () => {
    const storeSections = [mkSection([mkLine('a'), mkLine('b')])];
    const canonicalLines = [{ i: 0, text: 'a' }];
    expect(propagateSongbookText(storeSections, canonicalLines)).toBeNull();
  });

  it('descarta words cuando el conteo de tokens del texto nuevo cambio', () => {
    const storeSections = [
      mkSection([
        mkLine('hola mundo', {
          words: [
            { word: 'hola', startMs: 100, endMs: 400, score: 0.9 },
            { word: 'mundo', startMs: 500, endMs: 900, score: 0.8 },
          ],
        }),
      ]),
    ];
    const canonicalLines = [{ i: 0, text: 'hola mundo hoy' }];
    const result = propagateSongbookText(storeSections, canonicalLines);
    expect(result[0].lines[0].words).toEqual([]);
  });

  it('conserva words cuando el conteo de tokens del texto nuevo coincide (solo tildes/ortografia)', () => {
    const storeSections = [
      mkSection([
        mkLine('hola mundo', {
          words: [
            { word: 'hola', startMs: 100, endMs: 400, score: 0.9 },
            { word: 'mundo', startMs: 500, endMs: 900, score: 0.8 },
          ],
        }),
      ]),
    ];
    const canonicalLines = [{ i: 0, text: 'holá mundo' }];
    const result = propagateSongbookText(storeSections, canonicalLines);
    expect(result[0].lines[0].words).toHaveLength(2);
  });

  it('no muta storeSections de entrada', () => {
    const storeSections = [mkSection([mkLine('hola mundo')])];
    const snapshot = JSON.parse(JSON.stringify(storeSections));
    propagateSongbookText(storeSections, [{ i: 0, text: 'otra cosa' }]);
    expect(storeSections).toEqual(snapshot);
  });
});

describe('songbookDiverged', () => {
  const storeSections = [
    mkSection([mkLine('hola mundo'), mkLine('linea dos')]),
    mkSection([mkLine('linea tres')]),
  ];

  // storeSections trae label:null en las dos secciones, así que exportSections
  // cae a la etiqueta del tipo (SECTION_LABELS.verse = 'Verso'); las fixtures
  // de songSections necesitan type/label reales (no solo `lines`) porque la
  // comparación nueva es contra la sección completa que devolvería
  // exportSections, no solo contra el texto de sus renglones.
  it('false cuando el cancionero tiene el mismo numero de lineas y el mismo texto', () => {
    const songSections = [
      { type: 'verse', label: 'Verso', lines: [{ text: 'hola mundo' }, { text: 'linea dos' }] },
      { type: 'verse', label: 'Verso', lines: [{ text: 'linea tres' }] },
    ];
    expect(songbookDiverged(songSections, storeSections)).toBe(false);
  });

  it('true cuando cambia algun texto, aunque el numero de lineas coincida', () => {
    const songSections = [
      {
        type: 'verse',
        label: 'Verso',
        lines: [{ text: 'hola mundo cambiado' }, { text: 'linea dos' }],
      },
      { type: 'verse', label: 'Verso', lines: [{ text: 'linea tres' }] },
    ];
    expect(songbookDiverged(songSections, storeSections)).toBe(true);
  });

  it('true cuando cambia el numero de lineas canonicas', () => {
    const songSections = [{ type: 'verse', label: 'Verso', lines: [{ text: 'hola mundo' }] }];
    expect(songbookDiverged(songSections, storeSections)).toBe(true);
  });

  it('las lineas de anotacion no cuentan como divergencia (exportSections las reintercala igual)', () => {
    const songSections = [
      {
        type: 'verse',
        label: 'Verso',
        lines: [
          { text: 'hola mundo' },
          { text: '(coro)', annotation: true },
          { text: 'linea dos' },
        ],
      },
      { type: 'verse', label: 'Verso', lines: [{ text: 'linea tres' }] },
    ];
    expect(songbookDiverged(songSections, storeSections)).toBe(false);
  });

  it('los acordes cargados con el mismo texto no cuentan como divergencia', () => {
    const songSections = [
      {
        type: 'verse',
        label: 'Verso',
        lines: [{ text: 'hola mundo', chords: [{ pos: 0, ch: 'C' }] }, { text: 'linea dos' }],
      },
      { type: 'verse', label: 'Verso', lines: [{ text: 'linea tres' }] },
    ];
    expect(songbookDiverged(songSections, storeSections)).toBe(false);
  });

  it('una seccion de mas en el cancionero SI cuenta como divergencia: exportSections la descarta', () => {
    const songSections = [
      { type: 'verse', label: 'Verso', lines: [{ text: 'hola mundo' }, { text: 'linea dos' }] },
      { type: 'verse', label: 'Verso', lines: [{ text: 'linea tres' }] },
      { type: 'chorus', label: 'Coro', lines: [{ text: 'estribillo extra' }] },
    ];
    expect(songbookDiverged(songSections, storeSections)).toBe(true);
  });
});
