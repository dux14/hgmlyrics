import { describe, it, expect, vi } from 'vitest';

// SongEditor importa módulos con efectos de DOM/red; los stubeamos para poder
// importar y testear el helper puro de serialización (igual que songEditorNav.test.js).
vi.mock('../src/lib/store.js', () => ({ fetchSongDetail: vi.fn(), refreshData: vi.fn() }));
vi.mock('../src/router.js', () => ({ navigate: vi.fn() }));
vi.mock('../src/lib/authStore.js', () => ({
  getSession: vi.fn(() => null),
  isFeatureEnabled: vi.fn(() => true),
}));

const { blocksToSectionsV3 } = await import('../src/components/SongEditor.js');

describe('blocksToSectionsV3', () => {
  it('serializa groups y chords por línea + speedPreset por sección', () => {
    const blocks = [
      {
        type: 'verse',
        label: 'E1',
        speedPreset: 40,
        lines: [
          {
            id: 'l1',
            text: 'Santo es el Señor',
            groups: [{ start: 0, end: 5, voiceId: 'sop1', note: 'B3' }],
            chords: [{ pos: 0, ch: 'D' }],
            annotation: false,
          },
        ],
      },
    ];
    const out = blocksToSectionsV3(blocks);
    expect(out[0].speedPreset).toBe(40);
    expect(out[0].lines[0]).toEqual({
      text: 'Santo es el Señor',
      groups: [{ start: 0, end: 5, voiceId: 'sop1', note: 'B3' }],
      chords: [{ pos: 0, ch: 'D' }],
    });
  });

  it('omite groups/chords vacíos y filtra líneas sin contenido', () => {
    const blocks = [
      {
        type: 'verse',
        label: 'E1',
        lines: [
          { id: 'a', text: 'hola', groups: [], chords: [], annotation: false },
          { id: 'b', text: '   ', groups: [], chords: [], annotation: false },
        ],
      },
    ];
    const out = blocksToSectionsV3(blocks);
    expect(out[0].lines).toHaveLength(1);
    expect(out[0].lines[0]).toEqual({ text: 'hola' });
    expect(out[0].lines[0].groups).toBeUndefined();
    expect(out[0].lines[0].chords).toBeUndefined();
  });

  it('conserva una línea-anotación aunque su texto esté vacío de letra', () => {
    const blocks = [
      {
        type: 'verse',
        label: 'E1',
        lines: [{ id: 'a', text: '(x4)', groups: [], chords: [], annotation: true }],
      },
    ];
    const out = blocksToSectionsV3(blocks);
    expect(out[0].lines[0]).toEqual({ text: '(x4)', annotation: true });
  });

  it('normaliza note ausente a null', () => {
    const blocks = [
      {
        type: 'verse',
        label: 'E1',
        lines: [
          {
            id: 'a',
            text: 'abcd',
            groups: [{ start: 0, end: 2, voiceId: 'sop1' }],
            chords: [],
            annotation: false,
          },
        ],
      },
    ];
    const out = blocksToSectionsV3(blocks);
    expect(out[0].lines[0].groups[0].note).toBe(null);
  });
});
