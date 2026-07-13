import { describe, it, expect } from 'vitest';
import {
  buildHighlightedHTML,
  validateVoiceRanges,
  CANONICAL_VOICE_ORDER,
  deriveVoiceRanges,
} from '../src/lib/voiceSystem.js';
import { buildAnnotatedLineHTML } from '../src/lib/voiceSystem.js';

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

  it('devuelve la canción intacta si ya es v3 (no la corrompe — regresión Wave 3)', () => {
    const v3 = {
      schemaVersion: 3,
      voiceRoster: [{ id: 'v1', name: 'Voz 2', category: 'tenor', referenceKey: 'D3' }],
      sections: [
        {
          type: 'verse',
          label: 'E1',
          lines: [{ text: 'Santo', groups: [{ start: 0, end: 2, voiceId: 'v1', note: 'D3' }] }],
        },
      ],
    };
    const up = upgradeLegacySong(v3);
    expect(up).toBe(v3); // misma referencia: intacto
    expect(up.voiceRoster).toHaveLength(1); // NO se vacía → tonoAvailable sigue true
    expect(up.sections[0].lines[0].groups).toHaveLength(1); // groups preservados
    expect(up.schemaVersion).toBe(3); // no se degrada a 2
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
import { groupsForVoice } from '../src/lib/voiceSystem.js';
import { firstNoteForVoice, tonoGeneralForVoice } from '../src/lib/voiceSystem.js';

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

describe('groupsForVoice', () => {
  const line = {
    text: 'Santo, Santo es el Señor',
    groups: [
      { start: 9, end: 14, voiceId: 'sop1', note: 'A3' },
      { start: 0, end: 5, voiceId: 'sop1', note: 'B3' },
      { start: 0, end: 5, voiceId: 'ten1', note: 'D3' },
    ],
  };

  it('filtra por voz y ordena por start', () => {
    expect(groupsForVoice(line, 'sop1')).toEqual([
      { start: 0, end: 5, note: 'B3' },
      { start: 9, end: 14, note: 'A3' },
    ]);
  });

  it('devuelve [] si la voz no canta en la línea', () => {
    expect(groupsForVoice(line, 'baj1')).toEqual([]);
  });

  it('tolera línea sin groups', () => {
    expect(groupsForVoice({ text: 'x' }, 'sop1')).toEqual([]);
    expect(groupsForVoice(null, 'sop1')).toEqual([]);
  });

  it('normaliza note ausente a null', () => {
    const l = { groups: [{ start: 0, end: 2, voiceId: 'sop1' }] };
    expect(groupsForVoice(l, 'sop1')).toEqual([{ start: 0, end: 2, note: null }]);
  });
});

import { validateSongV3 } from '../src/lib/voiceSystem.js';

describe('validateSongV3', () => {
  const base = () => ({
    schemaVersion: 3,
    voiceRoster: [{ id: 'sop1', name: 'Voz 1', category: 'soprano', referenceKey: 'B3' }],
    sections: [
      {
        lines: [
          {
            text: 'Santo',
            groups: [{ start: 0, end: 5, voiceId: 'sop1', note: 'B3' }],
            chords: [{ pos: 0, ch: 'D' }],
          },
        ],
      },
    ],
  });

  it('acepta una canción v3 válida', () => {
    expect(validateSongV3(base())).toBe(true);
  });

  it('rechaza schemaVersion !== 3', () => {
    const s = base();
    s.schemaVersion = 2;
    expect(() => validateSongV3(s)).toThrow(/schemaVersion/);
  });

  it('rechaza category de roster inválida', () => {
    const s = base();
    s.voiceRoster[0].category = 'mezzo';
    expect(() => validateSongV3(s)).toThrow(/category/);
  });

  it('rechaza id de roster duplicado', () => {
    const s = base();
    s.voiceRoster.push({ id: 'sop1', name: 'dup', category: 'tenor' });
    expect(() => validateSongV3(s)).toThrow(/duplicado/);
  });

  it('rechaza referenceKey inválida', () => {
    const s = base();
    s.voiceRoster[0].referenceKey = 'H9';
    expect(() => validateSongV3(s)).toThrow(/referenceKey/);
  });

  it('rechaza group fuera de rango', () => {
    const s = base();
    s.sections[0].lines[0].groups[0].end = 99;
    expect(() => validateSongV3(s)).toThrow(/group fuera de rango/);
  });

  it('rechaza group start >= end', () => {
    const s = base();
    s.sections[0].lines[0].groups[0] = { start: 3, end: 3, voiceId: 'sop1', note: null };
    expect(() => validateSongV3(s)).toThrow(/group fuera de rango/);
  });

  it('rechaza group con voiceId inexistente', () => {
    const s = base();
    s.sections[0].lines[0].groups[0].voiceId = 'ghost';
    expect(() => validateSongV3(s)).toThrow(/roster inexistente/);
  });

  it('rechaza nota inválida en group', () => {
    const s = base();
    s.sections[0].lines[0].groups[0].note = 'X1';
    expect(() => validateSongV3(s)).toThrow(/nota inválida/);
  });

  it('acepta note null en group', () => {
    const s = base();
    s.sections[0].lines[0].groups[0].note = null;
    expect(validateSongV3(s)).toBe(true);
  });

  it('rechaza chord pos fuera de rango', () => {
    const s = base();
    s.sections[0].lines[0].chords[0].pos = 50;
    expect(() => validateSongV3(s)).toThrow(/chord pos/);
  });

  it('rechaza chord vacío', () => {
    const s = base();
    s.sections[0].lines[0].chords[0].ch = '   ';
    expect(() => validateSongV3(s)).toThrow(/chord vacío/);
  });
});

describe('firstNoteForVoice / tonoGeneralForVoice', () => {
  const song = {
    voiceRoster: [
      { id: 'sop1', name: 'Voz 1', category: 'soprano', referenceKey: 'C4' },
      { id: 'ten1', name: 'Voz 1', category: 'tenor' },
    ],
    sections: [
      {
        lines: [
          { text: 'aa', groups: [{ start: 0, end: 2, voiceId: 'ten1', note: null }] },
          {
            text: 'bbbb',
            groups: [
              { start: 0, end: 2, voiceId: 'ten1', note: 'D3' },
              { start: 2, end: 4, voiceId: 'sop1', note: 'B3' },
            ],
          },
        ],
      },
    ],
  };

  it('firstNoteForVoice toma la 1ª nota no nula en orden', () => {
    expect(firstNoteForVoice(song, 'ten1')).toBe('D3');
    expect(firstNoteForVoice(song, 'sop1')).toBe('B3');
  });

  it('firstNoteForVoice devuelve null si no hay notas', () => {
    expect(firstNoteForVoice(song, 'baj1')).toBe(null);
  });

  it('tonoGeneralForVoice usa referenceKey si existe', () => {
    expect(tonoGeneralForVoice(song, 'sop1')).toBe('C4');
  });

  it('tonoGeneralForVoice cae a la 1ª nota si no hay referenceKey', () => {
    expect(tonoGeneralForVoice(song, 'ten1')).toBe('D3');
  });
});

describe('validateSongV3 — campo spoken', () => {
  const base = (line) => ({
    schemaVersion: 3,
    voiceRoster: [],
    sections: [{ type: 'verse', label: 'V', lines: [line] }],
  });

  it('acepta una línea con spoken:true', () => {
    expect(validateSongV3(base({ text: 'Diciendo:', spoken: true }))).toBe(true);
  });

  it('acepta una línea sin el campo spoken (retrocompat)', () => {
    expect(validateSongV3(base({ text: 'Santo' }))).toBe(true);
  });

  it('rechaza spoken no booleano', () => {
    expect(() => validateSongV3(base({ text: 'x', spoken: 'sí' }))).toThrow(/spoken/);
  });
});

// Suma del texto visible (sin tags) — sirve para asegurar que la palabra no se parte.
const visibleText = (html) => html.replace(/<[^>]*>/g, '');

describe('buildAnnotatedLineHTML', () => {
  it('texto plano sin labels/spans → escapado sin wrappers', () => {
    expect(buildAnnotatedLineHTML('a<b>', {})).toBe('a&lt;b&gt;');
  });

  it('label en pos 0 → float-label con el texto', () => {
    const html = buildAnnotatedLineHTML('Santo', {
      labels: [{ pos: 0, text: 'D', className: 'c' }],
    });
    expect(html).toContain('float-label c');
    expect(html).toContain('>D<');
    expect(visibleText(html)).toBe('DSanto'); // label + texto, pero el texto sigue íntegro
  });

  it('NO parte la palabra: dos labels dentro de "universo" reconstruyen la palabra', () => {
    const html = buildAnnotatedLineHTML('universo', {
      labels: [
        { pos: 0, text: 'D4' },
        { pos: 1, text: 'B3' },
      ],
    });
    // El texto de la letra (quitando las etiquetas flotantes) sigue siendo "universo".
    const noLabels = html.replace(/<span class="float-label[^"]*">[^<]*<\/span>/g, '');
    expect(visibleText(noLabels)).toBe('universo');
  });

  it('span colorea su rango y baseClass cubre el resto', () => {
    const html = buildAnnotatedLineHTML('abcd', {
      spans: [{ start: 0, end: 2, className: 'voice-sop' }],
      baseClass: 'dim',
    });
    expect(html).toContain('voice-sop');
    expect(html).toContain('dim');
    expect(visibleText(html)).toBe('abcd');
  });

  it('label al final (pos === len) se renderiza igual', () => {
    const html = buildAnnotatedLineHTML('ab', { labels: [{ pos: 2, text: 'G' }] });
    expect(html).toContain('float-label');
    expect(html).toContain('>G<');
    // el texto visible de la letra sigue siendo "ab" (la G es etiqueta flotante)
    const noLabels = html.replace(/<span class="float-label[^"]*">[^<]*<\/span>/g, '');
    expect(visibleText(noLabels)).toBe('ab');
  });

  it('escapa el texto de la etiqueta', () => {
    const html = buildAnnotatedLineHTML('x', { labels: [{ pos: 0, text: 'F#<' }] });
    expect(html).toContain('F#&lt;');
  });
});

describe('buildAnnotatedLineHTML — integridad de palabra (line-word)', () => {
  it('modo Letra puro (sin labels/spans/baseClass) no genera .line-word', () => {
    const html = buildAnnotatedLineHTML('Llevame contigooo caminando', {});
    expect(html).not.toContain('line-word');
  });

  it('con anotaciones, agrupa una palabra partida por una anotación intra-palabra en UN solo .line-word', () => {
    const html = buildAnnotatedLineHTML('contigooo', {
      labels: [{ pos: 5, text: 'G', className: 'chord-label' }],
    });
    const wordMatches = html.match(/<span class="line-word">/g) || [];
    expect(wordMatches.length).toBe(1);
  });

  it('ninguna .line-word contiene un caracter de espacio', () => {
    const html = buildAnnotatedLineHTML('Llevame contigooo', {
      labels: [{ pos: 13, text: 'G', className: 'chord-label' }],
      baseClass: 'lyrics__letra-dim',
    });
    const words = [...html.matchAll(/<span class="line-word">(.*?)<\/span><\/span>|<span class="line-word">(.*?)<\/span>/g)];
    // Extrae el contenido visible (sin tags) de cada .line-word y verifica que no tenga espacios.
    const container = html;
    const wordBlocks = [];
    let idx = 0;
    while ((idx = container.indexOf('<span class="line-word">', idx)) !== -1) {
      let depth = 1;
      let cursor = idx + '<span class="line-word">'.length;
      while (depth > 0) {
        const nextOpen = container.indexOf('<span', cursor);
        const nextClose = container.indexOf('</span>', cursor);
        if (nextClose === -1) break;
        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          cursor = nextOpen + 5;
        } else {
          depth--;
          cursor = nextClose + 7;
        }
      }
      wordBlocks.push(container.slice(idx, cursor));
      idx = cursor;
    }
    expect(wordBlocks.length).toBeGreaterThan(0);
    for (const block of wordBlocks) {
      const visible = block.replace(/<[^>]*>/g, '');
      expect(visible).not.toMatch(/\s/);
    }
  });

  it('preserva el textContent exacto (incluidos espacios) con anotaciones', () => {
    const html = buildAnnotatedLineHTML('Llevame contigooo caminando siempre', {
      labels: [{ pos: 13, text: 'G', className: 'chord-label' }],
      baseClass: 'lyrics__letra-dim',
    });
    const visible = html.replace(/<[^>]*>/g, '');
    // El texto visible incluye la etiqueta "G" además de la letra — se remueve por separado.
    const withoutLabel = html.replace(/<span class="float-label[^"]*">[^<]*<\/span>/g, '');
    expect(withoutLabel.replace(/<[^>]*>/g, '')).toBe('Llevame contigooo caminando siempre');
    expect(visible).toContain('G');
  });

  it('separa palabras distintas en .line-word distintos, con el espacio como texto plano entre ellos', () => {
    const html = buildAnnotatedLineHTML('ab cd', { baseClass: 'dim' });
    const wordMatches = html.match(/<span class="line-word">/g) || [];
    expect(wordMatches.length).toBe(2);
    // El espacio no debe quedar envuelto en ningún span — debe ser texto plano entre wrappers.
    expect(html).toMatch(/<\/span><\/span> <span class="line-word">/);
  });

  it('REGRESIÓN (review Important): un label anclado exactamente sobre el espacio entre "ab" y "cd" NO debe fusionar ambas palabras en un solo .line-word', () => {
    const html = buildAnnotatedLineHTML('ab cd', { labels: [{ pos: 2, text: 'G' }] });
    const wordMatches = html.match(/<span class="line-word">/g) || [];
    expect(wordMatches.length).toBe(2); // "ab" y "cd" siguen siendo .line-word independientes
    // El textContent se preserva exacto (letra + etiqueta, espacio ni se pierde ni se duplica).
    const withoutLabel = html.replace(/<span class="float-label[^"]*">[^<]*<\/span>/g, '');
    expect(withoutLabel.replace(/<[^>]*>/g, '')).toBe('ab cd');
    expect(html).toContain('>G<');
  });
});

import { validateSongPreSave } from '../src/lib/voiceSystem.js';

describe('validateSongPreSave', () => {
  const base = () => ({
    sections: [
      {
        label: 'Verso 1',
        lines: [
          { text: 'Santo', chords: [{ pos: 0, ch: 'D' }] },
          { text: 'Es el Señor', chords: [] },
        ],
      },
    ],
  });

  it('acepta una canción v1 sin problemas', () => {
    const result = validateSongPreSave(base());
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('rechaza un acorde con pos fuera del texto, con mensaje por sección/línea', () => {
    const s = base();
    s.sections[0].lines[0].chords[0].pos = 99;
    const result = validateSongPreSave(s);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Verso 1, línea 1/);
    expect(result.errors[0]).toMatch(/fuera del texto/);
  });

  it('usa "Sección N" cuando la sección no tiene label', () => {
    const s = { sections: [{ lines: [{ text: 'ab', chords: [{ pos: 9, ch: 'D' }] }] }] };
    const result = validateSongPreSave(s);
    expect(result.errors[0]).toMatch(/Sección 1, línea 1/);
  });

  it('rechaza un acorde vacío', () => {
    const s = base();
    s.sections[0].lines[0].chords[0].ch = '   ';
    const result = validateSongPreSave(s);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/acorde vacío/);
  });

  it('rechaza un group v3 con nota inválida, ubicado por sección/línea', () => {
    const s = {
      schemaVersion: 3,
      voiceRoster: [{ id: 'sop1', category: 'soprano' }],
      sections: [
        {
          label: 'Coro',
          lines: [{ text: 'Santo', groups: [{ start: 0, end: 5, voiceId: 'sop1', note: 'X1' }] }],
        },
      ],
    };
    const result = validateSongPreSave(s);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Coro, línea 1/);
    expect(result.errors[0]).toMatch(/nota asignada no es válida/);
  });

  it('rechaza un group que referencia una voz fuera del elenco', () => {
    const s = {
      schemaVersion: 3,
      voiceRoster: [{ id: 'sop1', category: 'soprano' }],
      sections: [
        { lines: [{ text: 'Santo', groups: [{ start: 0, end: 5, voiceId: 'ghost', note: null }] }] },
      ],
    };
    const result = validateSongPreSave(s);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/no está en el elenco/);
  });

  it('traduce el mensaje técnico de validateSongV3 cuando no hay error de sección/línea', () => {
    const s = {
      schemaVersion: 3,
      voiceRoster: [
        { id: 'sop1', category: 'soprano' },
        { id: 'sop1', category: 'tenor' },
      ],
      sections: [],
    };
    const result = validateSongPreSave(s);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).not.toMatch(/roster/); // sin jerga técnica
    expect(result.errors[0]).toMatch(/identificador repetido/);
  });
});
