import { describe, it, expect, afterEach } from 'vitest';
import { openOptionsSheet, closeOptionsSheet } from './OptionsSheet.js';

afterEach(() => {
  closeOptionsSheet();
  document.body.innerHTML = '';
});

function baseSong() {
  return {
    key: 'G major',
    voiceRoster: [
      { id: 's1', category: 'soprano', name: 'Soprano', referenceKey: 'B3' },
      { id: 'a1', category: 'contralto', name: 'Contralto', referenceKey: null },
      { id: 't1', category: 'tenor', name: 'Tenor', referenceKey: null },
      { id: 'b1', category: 'bass', name: 'Bajo', referenceKey: null },
    ],
  };
}

describe('OptionsSheet — reorganización de grupos', () => {
  it('renderiza los labels exactos y en este orden: TONO, NOTACIÓN, TAMAÑO DE LETRA, AUTO-SCROLL', () => {
    openOptionsSheet({
      song: baseSong(),
      showTono: true,
      tonoLabel: '0 · Original',
      useFlats: false,
      notation: 'latin',
      fontLabel: '1.00',
      autoscrollLabel: '50%',
    });
    const headers = Array.from(document.querySelectorAll('.osheet__h')).map((h) => h.textContent);
    expect(headers).toEqual(['TONO', 'NOTACIÓN', 'TAMAÑO DE LETRA', 'AUTO-SCROLL']);
  });

  it('grupo TONO expone −½, +½, ♯/♭ y el valor central', () => {
    openOptionsSheet({
      song: baseSong(),
      showTono: true,
      tonoLabel: '0 · Original',
      useFlats: false,
    });
    expect(document.querySelector('[data-act="tdown"]').textContent).toBe('−½');
    expect(document.querySelector('[data-act="tup"]').textContent).toBe('+½');
    expect(document.querySelector('[data-act="accidental"]').textContent).toBe('♯');
    expect(document.querySelector('#osheet-tono').textContent).toBe('0 · Original');
  });
});
