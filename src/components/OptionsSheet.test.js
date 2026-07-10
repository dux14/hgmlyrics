import { describe, it, expect, afterEach } from 'vitest';
import { openOptionsSheet, closeOptionsSheet } from './OptionsSheet.js';

afterEach(() => {
  closeOptionsSheet();
  document.body.innerHTML = '';
});

describe('OptionsSheet — reorganización de grupos', () => {
  it('renderiza los labels exactos y en este orden: TONO, NOTACIÓN, TAMAÑO DE LETRA, AUTO-SCROLL', () => {
    openOptionsSheet({
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
