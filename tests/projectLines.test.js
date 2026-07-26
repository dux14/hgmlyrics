import { describe, it, expect, vi } from 'vitest';
import { projectLines, speedToSecondsPerLine } from '../src/lib/projectLines.js';

// align.js importa db.js/storage.js (exigen env vars en runtime real); aquí
// solo se usa projectCanonicalLines, una función pura, así que se mockean
// igual que en tests/apiAlign.test.js para poder importarla sin credenciales.
vi.mock('../api/_lib/db.js', () => ({ default: () => Promise.resolve([]) }));
vi.mock('../api/_lib/storage.js', () => ({
  signSongAudioDownload: vi.fn(),
}));
const { projectCanonicalLines } = await import('../api/_lib/align.js');

function buildSong(overrides = {}) {
  return {
    id: 'song-1',
    schemaVersion: 3,
    voiceRoster: [{ id: 'soprano-1', name: 'Soprano', category: 'soprano' }],
    sections: [
      {
        type: 'verse',
        label: 'Verso 1',
        lines: [
          {
            text: 'Primera línea',
            chords: [{ pos: 0, ch: 'C' }],
            groups: [{ start: 0, end: 7, voiceId: 'soprano-1', note: 'C4' }],
          },
          { text: 'Nota de ambiente', annotation: true },
          {
            text: 'Segunda línea',
            groups: [{ start: 0, end: 7, voiceId: 'soprano-1', note: 'D4' }],
          },
          {
            text: 'Hablado sin nota',
            spoken: true,
            groups: [{ start: 0, end: 7, voiceId: 'soprano-1', note: 'E4' }],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('speedToSecondsPerLine', () => {
  it('mapea velocidad mínima a la duración lenta y máxima a la rápida', () => {
    expect(speedToSecondsPerLine(0.01)).toBeCloseTo(9);
    expect(speedToSecondsPerLine(2.0)).toBeCloseTo(2.5);
  });

  it('es monótona decreciente entre los extremos', () => {
    expect(speedToSecondsPerLine(0.5)).toBeGreaterThan(speedToSecondsPerLine(1.5));
  });
});

describe('projectLines', () => {
  it('aplana las secciones y salta las líneas annotation', () => {
    const lines = projectLines(buildSong());
    expect(lines).toHaveLength(3); // 4 líneas - 1 annotation
    expect(lines.every((l) => l.text !== 'Nota de ambiente')).toBe(true);
  });

  it('sin voz activa no hay nota, solo texto/acordes', () => {
    const lines = projectLines(buildSong());
    expect(lines[0].note).toBeNull();
    expect(lines[0].chords).toEqual(['C']);
  });

  it('con voz activa, toma la primera nota de esa voz en la línea', () => {
    const lines = projectLines(buildSong(), { getActiveVoice: () => 'soprano-1' });
    expect(lines[0].note).toBe('C4');
    expect(lines[1].note).toBe('D4');
  });

  it('transpone la nota según getTranspose', () => {
    const lines = projectLines(buildSong(), {
      getActiveVoice: () => 'soprano-1',
      getTranspose: () => ({ semitones: 2, useFlats: false }),
    });
    expect(lines[0].note).toBe('D4');
  });

  it('respeta la notación latina en displayNote', () => {
    const lines = projectLines(buildSong(), {
      getActiveVoice: () => 'soprano-1',
      getNotation: () => 'latin',
    });
    expect(lines[0].note).toBe('Do4');
  });

  it('las líneas spoken no muestran nota aunque haya voz activa', () => {
    const lines = projectLines(buildSong(), { getActiveVoice: () => 'soprano-1' });
    const spokenLine = lines.find((l) => l.spoken);
    expect(spokenLine.note).toBeNull();
  });

  it('T6: conserva chords[] crudos (chordsRaw) y TODAS las notas por sílaba (groups), no solo la primera', () => {
    const song = buildSong({
      sections: [
        {
          type: 'verse',
          label: 'Verso 1',
          lines: [
            {
              text: 'Primera línea',
              chords: [{ pos: 0, ch: 'C' }],
              groups: [
                { start: 0, end: 7, voiceId: 'soprano-1', note: 'C4' },
                { start: 8, end: 13, voiceId: 'soprano-1', note: 'D4' },
              ],
            },
          ],
        },
      ],
    });
    const lines = projectLines(song, { getActiveVoice: () => 'soprano-1' });
    expect(lines[0].chordsRaw).toEqual([{ pos: 0, ch: 'C' }]);
    expect(lines[0].groups).toHaveLength(2);
    expect(lines[0].groups.map((g) => g.note)).toEqual(['C4', 'D4']);
    // El campo `note` (chip compacto, compat) sigue siendo solo la primera.
    expect(lines[0].note).toBe('C4');
  });

  it('C3: `i` es un índice incremental estable, igual al índice del array resultante', () => {
    const lines = projectLines(buildSong());
    lines.forEach((line, idx) => expect(line.i).toBe(idx));
  });

  it('C3: paridad con projectCanonicalLines del back (api/_lib/align.js) en modo letra sin voz', () => {
    // Misma fixture "Santo" que tests/apiAlign.test.js (secciones con
    // annotation y spoken), para garantizar que ambas proyecciones coinciden
    // en cuenta de líneas y textos.
    const santoSections = [
      {
        type: 'verse',
        lines: [
          { text: 'Santo, Santo, Santo' },
          { text: '(instrumental)', annotation: true },
          { text: 'Por eso con los ángeles, diciendo:', spoken: true },
        ],
      },
      {
        type: 'chorus',
        lines: [{ text: '(x2)', annotation: true }, { text: 'Es el Señor' }],
      },
    ];
    const canonical = projectCanonicalLines(santoSections);
    const front = projectLines({ sections: santoSections });

    expect(front).toHaveLength(canonical.length);
    expect(front.map((l) => ({ i: l.i, text: l.text }))).toEqual(canonical);
  });
});
