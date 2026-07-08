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
  it('renderiza los labels exactos y en este orden: TONO, NOTACIÓN, TAMAÑO DE LETRA, AUTO-SCROLL, VOCES VISIBLES', () => {
    openOptionsSheet({
      song: baseSong(),
      visibleVoices: new Set(['s1', 'a1', 't1', 'b1']),
      showTono: true,
      tonoLabel: '0 · Original',
      useFlats: false,
      notation: 'latin',
      fontLabel: '1.00',
      autoscrollLabel: '50%',
    });
    const headers = Array.from(document.querySelectorAll('.osheet__h')).map((h) => h.textContent);
    expect(headers).toEqual(['TONO', 'NOTACIÓN', 'TAMAÑO DE LETRA', 'AUTO-SCROLL', 'VOCES VISIBLES']);
  });

  it('grupo TONO expone −½, +½, ♯/♭ y el valor central', () => {
    openOptionsSheet({
      song: baseSong(),
      visibleVoices: new Set(),
      showTono: true,
      tonoLabel: '0 · Original',
      useFlats: false,
    });
    expect(document.querySelector('[data-act="tdown"]').textContent).toBe('−½');
    expect(document.querySelector('[data-act="tup"]').textContent).toBe('+½');
    expect(document.querySelector('[data-act="accidental"]').textContent).toBe('♯');
    expect(document.querySelector('#osheet-tono').textContent).toBe('0 · Original');
  });

  it('filas de voces muestran nombres reales, nunca el patrón "Voz N"', () => {
    openOptionsSheet({
      song: baseSong(),
      visibleVoices: new Set(['s1', 'a1', 't1', 'b1']),
      showTono: false,
    });
    const names = Array.from(document.querySelectorAll('.osheet__voice-name')).map((n) => n.textContent);
    expect(names).toEqual(['Soprano', 'Contralto', 'Tenor', 'Bajo']);
    names.forEach((name) => expect(name).not.toMatch(/^Voz \d+$/));
  });

  it('FIX finding 3: showVoices: false oculta VOCES VISIBLES aunque haya roster', () => {
    openOptionsSheet({
      song: baseSong(),
      visibleVoices: new Set(['s1', 'a1', 't1', 'b1']),
      showVoices: false,
      showTono: false,
    });
    const headers = Array.from(document.querySelectorAll('.osheet__h')).map((h) => h.textContent);
    expect(headers).not.toContain('VOCES VISIBLES');
    expect(document.querySelector('.osheet__voices')).toBeNull();
  });

  it('showVoices por defecto (sin pasar el flag): sigue mostrando VOCES VISIBLES', () => {
    openOptionsSheet({
      song: baseSong(),
      visibleVoices: new Set(['s1', 'a1', 't1', 'b1']),
      showTono: false,
    });
    const headers = Array.from(document.querySelectorAll('.osheet__h')).map((h) => h.textContent);
    expect(headers).toContain('VOCES VISIBLES');
  });
});
