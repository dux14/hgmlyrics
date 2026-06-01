import { describe, it, expect } from 'vitest';
import {
  buildHighlightedHTML,
  validateVoiceRanges,
  CANONICAL_VOICE_ORDER,
  deriveVoiceRanges,
} from '../src/lib/voiceSystem.js';

describe('CANONICAL_VOICE_ORDER', () => {
  it('is soprano > contralto > tenor > bass', () => {
    expect(CANONICAL_VOICE_ORDER).toEqual(['soprano', 'contralto', 'tenor', 'bass']);
  });
});

describe('buildHighlightedHTML — empty / no ranges', () => {
  it('returns escaped text when voiceRanges is empty', () => {
    expect(buildHighlightedHTML('hola', [])).toBe('hola');
  });

  it('returns empty string for empty text + empty ranges', () => {
    expect(buildHighlightedHTML('', [])).toBe('');
  });

  it('escapes HTML special chars in plain text', () => {
    const html = buildHighlightedHTML('a<b>c&d"e', []);
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  });

  it('with activeVoice="all" and no ranges, returns bare escaped text (no spans)', () => {
    expect(buildHighlightedHTML('hola', [], 'all')).toBe('hola');
  });

  it('with activeVoice="soprano" and no ranges, wraps text in dimmed span', () => {
    const html = buildHighlightedHTML('hola', [], 'soprano');
    expect(html).toContain('voice-text--dimmed');
    expect(html).toContain('hola');
  });
});

describe('buildHighlightedHTML — activeVoice="all"', () => {
  it('colors a single-voice range with its color class', () => {
    const html = buildHighlightedHTML('Señor', [{ start: 0, end: 5, voices: ['soprano'] }], 'all');
    expect(html).toContain('voice-text--soprano');
    expect(html).toContain('Señor');
  });

  it('colors multi-voice range with FIRST canonical voice', () => {
    const html = buildHighlightedHTML(
      'Señor',
      [{ start: 0, end: 5, voices: ['tenor', 'soprano'] }],
      'all',
    );
    expect(html).toContain('voice-text--soprano');
    expect(html).not.toContain('voice-text--tenor');
  });

  it('appends +N badge for multi-voice range (N = extras count)', () => {
    const html = buildHighlightedHTML(
      'Señor',
      [{ start: 0, end: 5, voices: ['soprano', 'contralto', 'tenor'] }],
      'all',
    );
    expect(html).toContain('voice-badge-extra');
    expect(html).toContain('+2');
  });

  it('badge color class matches SECOND canonical voice', () => {
    const html = buildHighlightedHTML(
      'Señor',
      [{ start: 0, end: 5, voices: ['contralto', 'soprano'] }],
      'all',
    );
    expect(html).toContain('voice-badge-extra--contralto');
  });

  it('no badge for single-voice range', () => {
    const html = buildHighlightedHTML('Señor', [{ start: 0, end: 5, voices: ['soprano'] }], 'all');
    expect(html).not.toContain('voice-badge-extra');
  });

  it('plain gap text outside any range is bare (no span)', () => {
    const html = buildHighlightedHTML(
      'hola mundo',
      [{ start: 5, end: 10, voices: ['tenor'] }],
      'all',
    );
    expect(html.startsWith('hola ')).toBe(true);
    expect(html).toContain('voice-text--tenor');
  });
});

describe('buildHighlightedHTML — activeVoice="soprano" (specific voice)', () => {
  it('renders matching range with voice color, no dim, no badge', () => {
    const html = buildHighlightedHTML(
      'Señor',
      [{ start: 0, end: 5, voices: ['soprano', 'contralto'] }],
      'soprano',
    );
    expect(html).toContain('voice-text--soprano');
    expect(html).not.toContain('voice-text--dimmed');
    expect(html).not.toContain('voice-badge-extra');
  });

  it('renders non-matching range with dimmed class only', () => {
    const html = buildHighlightedHTML(
      'Señor',
      [{ start: 0, end: 5, voices: ['contralto'] }],
      'soprano',
    );
    expect(html).toContain('voice-text--dimmed');
    expect(html).not.toContain('voice-text--soprano');
    expect(html).not.toContain('voice-text--contralto');
  });

  it('dims plain gap text outside any range', () => {
    const html = buildHighlightedHTML(
      'hola mundo',
      [{ start: 5, end: 10, voices: ['soprano'] }],
      'soprano',
    );
    expect(html).toContain('voice-text--dimmed');
    expect(html).toContain('voice-text--soprano');
    const dimmedCount = (html.match(/voice-text--dimmed/g) || []).length;
    expect(dimmedCount).toBe(1);
  });
});

describe('buildHighlightedHTML — contiguous ranges + invalid IDs', () => {
  it('renders two contiguous ranges as separate spans (all mode)', () => {
    const html = buildHighlightedHTML(
      'hola',
      [
        { start: 0, end: 2, voices: ['soprano'] },
        { start: 2, end: 4, voices: ['bass'] },
      ],
      'all',
    );
    expect(html).toContain('voice-text--soprano');
    expect(html).toContain('voice-text--bass');
  });

  it('silently skips invalid voice IDs when computing first voice', () => {
    const html = buildHighlightedHTML(
      'hi',
      [{ start: 0, end: 2, voices: ['invalid_id', 'soprano'] }],
      'all',
    );
    expect(html).toContain('voice-text--soprano');
    expect(html).not.toContain('voice-text--invalid_id');
  });

  it('drops range entirely if all voice IDs invalid', () => {
    const html = buildHighlightedHTML('hi', [{ start: 0, end: 2, voices: ['bogus'] }], 'all');
    expect(html).not.toContain('voice-text--');
    expect(html).toContain('hi');
  });
});

describe('validateVoiceRanges', () => {
  it('trims ranges that exceed text length', () => {
    expect(validateVoiceRanges([{ start: 0, end: 10, voices: ['soprano'] }], 5)).toEqual([
      { start: 0, end: 5, voices: ['soprano'] },
    ]);
  });

  it('drops ranges entirely outside text length', () => {
    expect(validateVoiceRanges([{ start: 10, end: 20, voices: ['soprano'] }], 5)).toEqual([]);
  });

  it('drops ranges with empty voices array', () => {
    expect(validateVoiceRanges([{ start: 0, end: 3, voices: [] }], 100)).toEqual([]);
  });

  it('reorders by start ascending', () => {
    const out = validateVoiceRanges(
      [
        { start: 5, end: 10, voices: ['bass'] },
        { start: 0, end: 3, voices: ['soprano'] },
      ],
      100,
    );
    expect(out).toEqual([
      { start: 0, end: 3, voices: ['soprano'] },
      { start: 5, end: 10, voices: ['bass'] },
    ]);
  });

  it('returns [] for null/undefined input', () => {
    expect(validateVoiceRanges(null, 10)).toEqual([]);
    expect(validateVoiceRanges(undefined, 10)).toEqual([]);
  });

  it('drops ranges where start >= end after trimming', () => {
    expect(validateVoiceRanges([{ start: 5, end: 10, voices: ['soprano'] }], 5)).toEqual([]);
  });
});

import { isValidNote } from '../src/lib/voiceSystem.js';

describe('isValidNote', () => {
  it('acepta notas científicas válidas', () => {
    for (const n of ['B3', 'A3', 'F#3', 'D4', 'C0', 'G7', 'Eb5']) {
      expect(isValidNote(n)).toBe(true);
    }
  });
  it('rechaza inválidas', () => {
    for (const n of ['H3', 'B', '3', 'B#9', '', null, 42, 'B33']) {
      expect(isValidNote(n)).toBe(false);
    }
  });
});

import { upgradeLegacySong } from '../src/lib/voiceSystem.js';

describe('upgradeLegacySong', () => {
  it('devuelve la canción intacta si ya es v2', () => {
    const v2 = { schemaVersion: 2, voiceRoster: [], sections: [] };
    expect(upgradeLegacySong(v2)).toBe(v2);
  });

  it('deriva roster desde las categorías usadas en voiceRanges', () => {
    const v1 = {
      sections: [
        {
          type: 'verse',
          label: 'E1',
          lines: [
            { text: 'Santo', voiceRanges: [{ start: 0, end: 5, voices: ['soprano', 'tenor'] }] },
          ],
        },
      ],
    };
    const up = upgradeLegacySong(v1);
    expect(up.schemaVersion).toBe(2);
    const cats = up.voiceRoster.map((v) => v.category).sort();
    expect(cats).toEqual(['soprano', 'tenor']);
    // ids estables = category cuando hay una sola persona por categoría
    expect(up.voiceRoster.find((v) => v.category === 'soprano').id).toBe('soprano');
  });

  it('convierte voiceRanges a voiceLines sin notas, sobre sílaba única por rango', () => {
    const v1 = {
      sections: [
        {
          type: 'verse',
          label: 'E1',
          lines: [{ text: 'Santo', voiceRanges: [{ start: 0, end: 5, voices: ['soprano'] }] }],
        },
      ],
    };
    const up = upgradeLegacySong(v1);
    const line = up.sections[0].lines[0];
    expect(line.text).toBe('Santo'); // intacto
    expect(line.syllables).toEqual([{ start: 0, end: 5 }]);
    expect(line.voiceLines.soprano.sungSyllables).toEqual([0]);
    expect(line.voiceLines.soprano.notes).toEqual([null]);
  });

  it('no falla con líneas sin voiceRanges', () => {
    const v1 = { sections: [{ type: 'verse', label: 'E', lines: [{ text: 'la la' }] }] };
    const up = upgradeLegacySong(v1);
    expect(up.sections[0].lines[0].voiceLines).toEqual({});
  });
});

import { validateSongV2 } from '../src/lib/voiceSystem.js';

describe('validateSongV2', () => {
  const baseRoster = [{ id: 'sop-a', name: 'Soprano A', category: 'soprano', referenceKey: 'D5' }];

  it('acepta una canción v2 mínima válida', () => {
    const song = {
      schemaVersion: 2,
      voiceRoster: baseRoster,
      sections: [
        {
          type: 'verse',
          label: 'E1',
          lines: [
            {
              text: 'Santo',
              syllables: [{ start: 0, end: 5 }],
              voiceLines: { 'sop-a': { sungSyllables: [0], notes: ['B3'] } },
            },
          ],
        },
      ],
    };
    expect(() => validateSongV2(song)).not.toThrow();
  });

  it('acepta una sílaba extensora de ancho cero (melisma)', () => {
    const song = {
      schemaVersion: 2,
      voiceRoster: baseRoster,
      sections: [
        {
          type: 'verse',
          label: 'E1',
          lines: [
            {
              text: 'o',
              syllables: [
                { start: 0, end: 1 },
                { start: 1, end: 1 },
              ],
              voiceLines: { 'sop-a': { sungSyllables: [0, 1], notes: ['D4', 'D4'] } },
            },
          ],
        },
      ],
    };
    expect(() => validateSongV2(song)).not.toThrow();
  });

  it('rechaza roster con category inválida', () => {
    const song = {
      schemaVersion: 2,
      voiceRoster: [{ id: 'x', name: 'X', category: 'alto' }],
      sections: [],
    };
    expect(() => validateSongV2(song)).toThrow(/category/i);
  });

  it('rechaza ids de roster duplicados', () => {
    const song = {
      schemaVersion: 2,
      voiceRoster: [
        { id: 'a', name: 'A', category: 'soprano' },
        { id: 'a', name: 'B', category: 'tenor' },
      ],
      sections: [],
    };
    expect(() => validateSongV2(song)).toThrow(/id/i);
  });

  it('rechaza syllables solapadas o fuera de rango', () => {
    const song = {
      schemaVersion: 2,
      voiceRoster: baseRoster,
      sections: [
        {
          type: 'verse',
          label: 'E',
          lines: [
            {
              text: 'Santo',
              syllables: [
                { start: 0, end: 3 },
                { start: 2, end: 5 },
              ],
            },
          ],
        },
      ],
    };
    expect(() => validateSongV2(song)).toThrow(/solap|overlap/i);
  });

  it('rechaza voiceLines con notes y sungSyllables desalineados', () => {
    const song = {
      schemaVersion: 2,
      voiceRoster: baseRoster,
      sections: [
        {
          type: 'verse',
          label: 'E',
          lines: [
            {
              text: 'Santo',
              syllables: [{ start: 0, end: 5 }],
              voiceLines: { 'sop-a': { sungSyllables: [0], notes: ['B3', 'A3'] } },
            },
          ],
        },
      ],
    };
    expect(() => validateSongV2(song)).toThrow(/align|alinea|length/i);
  });

  it('rechaza voiceLines que referencian un rosterId inexistente', () => {
    const song = {
      schemaVersion: 2,
      voiceRoster: baseRoster,
      sections: [
        {
          type: 'verse',
          label: 'E',
          lines: [
            {
              text: 'Santo',
              syllables: [{ start: 0, end: 5 }],
              voiceLines: { ghost: { sungSyllables: [0], notes: ['B3'] } },
            },
          ],
        },
      ],
    };
    expect(() => validateSongV2(song)).toThrow(/roster/i);
  });

  it('rechaza notas inválidas', () => {
    const song = {
      schemaVersion: 2,
      voiceRoster: baseRoster,
      sections: [
        {
          type: 'verse',
          label: 'E',
          lines: [
            {
              text: 'Santo',
              syllables: [{ start: 0, end: 5 }],
              voiceLines: { 'sop-a': { sungSyllables: [0], notes: ['H9'] } },
            },
          ],
        },
      ],
    };
    expect(() => validateSongV2(song)).toThrow(/nota|note/i);
  });
});

import { resolveSyllableNotes } from '../src/lib/voiceSystem.js';

describe('resolveSyllableNotes', () => {
  const line = {
    text: 'Santo',
    syllables: [
      { start: 0, end: 3 },
      { start: 3, end: 5 },
    ], // "San" "to"
    voiceLines: { 'sop-a': { sungSyllables: [0], notes: ['B3'] } },
  };

  it('marca sung + note por sílaba para la voz activa', () => {
    const out = resolveSyllableNotes(line, 'sop-a');
    expect(out).toEqual([
      { text: 'San', note: 'B3', sung: true },
      { text: 'to', note: null, sung: false },
    ]);
  });

  it('si la voz no canta nada, todas las sílabas sung=false', () => {
    const out = resolveSyllableNotes(line, 'ten-1');
    expect(out.every((s) => s.sung === false && s.note === null)).toBe(true);
  });

  it('línea sin syllables devuelve array vacío', () => {
    expect(resolveSyllableNotes({ text: 'x' }, 'sop-a')).toEqual([]);
  });
});

import { buildSyllableNotesHTML } from '../src/lib/voiceSystem.js';

describe('buildSyllableNotesHTML', () => {
  const line = {
    text: 'Santo',
    syllables: [
      { start: 0, end: 3 },
      { start: 3, end: 5 },
    ],
    voiceLines: { 'sop-a': { sungSyllables: [0], notes: ['B3'] } },
  };

  it('renderiza una columna por sílaba con su nota arriba', () => {
    const html = buildSyllableNotesHTML(line, 'sop-a');
    expect(html).toContain('B3');
    expect(html).toContain('San');
    expect(html).toContain('to');
    expect(html).toContain('syll__note');
  });

  it('marca como dimmed las sílabas que la voz no canta', () => {
    const html = buildSyllableNotesHTML(line, 'sop-a');
    // "to" no la canta sop-a → dimmed
    expect(html).toMatch(/syll--dimmed[^>]*>.*to/s);
  });

  it('escapa HTML del texto', () => {
    const evil = {
      text: '<b>x',
      syllables: [{ start: 0, end: 4 }],
      voiceLines: { 'sop-a': { sungSyllables: [0], notes: ['C4'] } },
    };
    const html = buildSyllableNotesHTML(evil, 'sop-a');
    expect(html).not.toContain('<b>x');
    expect(html).toContain('&lt;b&gt;');
  });

  it('sílaba extensora (texto vacío) renderiza glifo de melisma', () => {
    const mel = {
      text: 'o',
      syllables: [
        { start: 0, end: 1 },
        { start: 1, end: 1 },
      ],
      voiceLines: { 'sop-a': { sungSyllables: [0, 1], notes: ['D4', 'D4'] } },
    };
    const html = buildSyllableNotesHTML(mel, 'sop-a');
    expect(html).toContain('syll--melisma');
  });
});

import { deriveReferenceKey, rosterByCategory } from '../src/lib/voiceSystem.js';

describe('rosterByCategory', () => {
  it('filtra el roster por categoría conservando orden', () => {
    const song = {
      voiceRoster: [
        { id: 'sop-a', name: 'A', category: 'soprano' },
        { id: 'ten', name: 'T', category: 'tenor' },
        { id: 'sop-b', name: 'B', category: 'soprano' },
      ],
    };
    expect(rosterByCategory(song, 'soprano').map((v) => v.id)).toEqual(['sop-a', 'sop-b']);
  });
});

describe('deriveReferenceKey', () => {
  it('usa referenceKey explícito si existe', () => {
    const song = {
      voiceRoster: [{ id: 'sop-a', name: 'A', category: 'soprano', referenceKey: 'D5' }],
      sections: [],
    };
    expect(deriveReferenceKey(song, 'sop-a')).toBe('D5');
  });

  it('deriva la primera nota no nula de la voz si no hay referenceKey', () => {
    const song = {
      voiceRoster: [{ id: 'sop-a', name: 'A', category: 'soprano' }],
      sections: [
        {
          lines: [
            {
              text: 'ab',
              syllables: [
                { start: 0, end: 1 },
                { start: 1, end: 2 },
              ],
              voiceLines: { 'sop-a': { sungSyllables: [0, 1], notes: [null, 'F#3'] } },
            },
          ],
        },
      ],
    };
    expect(deriveReferenceKey(song, 'sop-a')).toBe('F#3');
  });

  it('devuelve null si no hay nota ni referenceKey', () => {
    const song = {
      voiceRoster: [{ id: 'sop-a', name: 'A', category: 'soprano' }],
      sections: [],
    };
    expect(deriveReferenceKey(song, 'sop-a')).toBe(null);
  });
});

describe('deriveVoiceRanges', () => {
  const roster = [
    { id: 'sop', category: 'soprano' },
    { id: 'ten', category: 'tenor' },
  ];

  it('homofónico: todas las voces cantan todas las sílabas → un rango con ambas (orden canónico)', () => {
    const line = {
      text: 'abcd',
      syllables: [
        { start: 0, end: 2 },
        { start: 2, end: 4 },
      ],
      voiceLines: {
        sop: { sungSyllables: [0, 1], notes: ['C4', 'D4'] },
        ten: { sungSyllables: [0, 1], notes: ['C3', 'D3'] },
      },
    };
    expect(deriveVoiceRanges(line, roster)).toEqual([
      { start: 0, end: 4, voices: ['soprano', 'tenor'] },
    ]);
  });

  it('parcial: cada voz una sílaba distinta → dos rangos', () => {
    const line = {
      text: 'abcd',
      syllables: [
        { start: 0, end: 2 },
        { start: 2, end: 4 },
      ],
      voiceLines: {
        sop: { sungSyllables: [0], notes: ['C4'] },
        ten: { sungSyllables: [1], notes: ['C3'] },
      },
    };
    expect(deriveVoiceRanges(line, roster)).toEqual([
      { start: 0, end: 2, voices: ['soprano'] },
      { start: 2, end: 4, voices: ['tenor'] },
    ]);
  });

  it('ignora extensores de melisma (ancho cero)', () => {
    const line = {
      text: 'ab',
      syllables: [
        { start: 0, end: 2 },
        { start: 2, end: 2 },
      ],
      voiceLines: { sop: { sungSyllables: [0, 1], notes: ['C4', 'D4'] } },
    };
    expect(deriveVoiceRanges(line, roster)).toEqual([{ start: 0, end: 2, voices: ['soprano'] }]);
  });

  it('sin voiceLines: devuelve los voiceRanges existentes sin tocar', () => {
    const existing = [{ start: 0, end: 3, voices: ['bass'] }];
    expect(deriveVoiceRanges({ text: 'abc', voiceRanges: existing }, roster)).toBe(existing);
  });

  it('sin voiceLines ni voiceRanges: devuelve []', () => {
    expect(deriveVoiceRanges({ text: 'abc' }, roster)).toEqual([]);
  });
});
