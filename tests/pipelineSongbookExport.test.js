import { describe, it, expect } from 'vitest';
import { exportSections } from '../api/_lib/pipeline/songbookExport.js';

const approved = [
  { type: 'verse', label: null, lines: [{ text: 'uno' }, { text: 'dos', vocalization: true }] },
];

describe('exportSections', () => {
  it('conserva chords y groups cuando el texto no cambió', () => {
    const song = [
      {
        type: 'verse',
        label: 'Verso',
        speedPreset: 'slow',
        lines: [
          {
            text: 'uno',
            chords: [{ pos: 0, ch: 'C' }],
            groups: [{ start: 0, end: 3, voiceId: 'lead', note: 'B3' }],
          },
          { text: 'dos' },
        ],
      },
    ];
    const { sections, dropped } = exportSections(approved, song);
    expect(sections[0].lines[0].chords).toEqual([{ pos: 0, ch: 'C' }]);
    expect(sections[0].lines[0].groups).toHaveLength(1);
    expect(sections[0].speedPreset).toBe('slow');
    expect(dropped).toEqual([]);
  });

  it('suelta chords y groups cuando el texto cambió, y lo reporta', () => {
    const song = [
      {
        type: 'verse',
        label: null,
        lines: [{ text: 'otro texto', chords: [{ pos: 0, ch: 'C' }] }, { text: 'dos' }],
      },
    ];
    const { sections, dropped } = exportSections(approved, song);
    expect(sections[0].lines[0].chords).toBeUndefined();
    expect(dropped).toEqual([{ sectionIndex: 0, lineIndex: 0, text: 'uno', reason: 'chords' }]);
  });

  it('sin label propio escribe la etiqueta del tipo, y marca spoken la vocalización', () => {
    const { sections } = exportSections(approved, []);
    expect(sections[0].label).toBe('Verso');
    expect(sections[0].lines[1]).toEqual({ text: 'dos', spoken: true });
  });

  it('label vacío también cae a la etiqueta del tipo', () => {
    const song = [{ type: 'verse', label: '', lines: [{ text: 'uno' }, { text: 'dos' }] }];
    const { sections } = exportSections(approved, song);
    expect(sections[0].label).toBe('Verso');
  });

  it('reancla la anotación después del renglón que la precedía', () => {
    const song = [
      {
        type: 'verse',
        label: null,
        lines: [{ text: 'uno' }, { text: 'a capela', annotation: true }, { text: 'dos' }],
      },
    ];
    const { sections } = exportSections(approved, song);
    expect(sections[0].lines.map((l) => l.text)).toEqual(['uno', 'a capela', 'dos']);
    expect(sections[0].lines[1].annotation).toBe(true);
  });

  it('anotación anclada a un índice que ya no existe se pierde y se reporta', () => {
    // El cancionero tiene 3 renglones canónicos (uno/dos/tres), pero el gate
    // aprobó solo 2 (approved): la anotación anclada tras 'tres' (índice 2) ya
    // no tiene dónde engancharse.
    const song = [
      {
        type: 'verse',
        label: null,
        lines: [
          { text: 'uno' },
          { text: 'dos' },
          { text: 'tres' },
          { text: 'nota huérfana', annotation: true },
        ],
      },
    ];
    const { sections, dropped } = exportSections(approved, song);
    expect(sections[0].lines.map((l) => l.text)).toEqual(['uno', 'dos']);
    expect(dropped).toEqual([
      { sectionIndex: 0, lineIndex: 2, text: 'nota huérfana', reason: 'annotation' },
    ]);
  });

  it('es idempotente', () => {
    const once = exportSections(approved, []).sections;
    const twice = exportSections(approved, once).sections;
    expect(twice).toEqual(once);
  });

  it('es idempotente con anotaciones presentes', () => {
    const song = [
      {
        type: 'verse',
        label: null,
        lines: [{ text: 'uno' }, { text: 'a capela', annotation: true }, { text: 'dos' }],
      },
    ];
    const once = exportSections(approved, song).sections;
    const twice = exportSections(approved, once).sections;
    expect(twice).toEqual(once);
  });

  it('no muta la entrada', () => {
    const song = [
      {
        type: 'verse',
        label: 'Verso',
        speedPreset: 'slow',
        lines: [
          { text: 'uno', chords: [{ pos: 0, ch: 'C' }] },
          { text: 'dos', annotation: false },
        ],
      },
    ];
    const approvedCopy = JSON.parse(JSON.stringify(approved));
    const songCopy = JSON.parse(JSON.stringify(song));
    exportSections(approved, song);
    expect(approved).toEqual(approvedCopy);
    expect(song).toEqual(songCopy);
  });
});
