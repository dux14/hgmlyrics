import { describe, it, expect, afterEach, vi } from 'vitest';
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

describe('re-render in place (T-refresh)', () => {
  it('reabrir con voiceOptions nuevas pinta la sección VOZ sin cerrar', () => {
    const first = openOptionsSheet({
      showTono: false,
      notation: 'anglo',
      fontLabel: '1.00',
      autoscrollLabel: '50%',
    });
    expect(first.sheet.querySelector('[data-voice]')).toBeNull();
    const second = openOptionsSheet({
      showTono: false,
      notation: 'anglo',
      fontLabel: '1.00',
      autoscrollLabel: '50%',
      voiceOptions: [
        { value: 'soprano', label: 'Soprano' },
        { value: 'bass', label: 'Bajo' },
      ],
      activeVoiceCategory: null,
    });
    expect(second.sheet).toBe(first.sheet); // mismo nodo, no un sheet nuevo
    expect(second.sheet.querySelectorAll('[data-voice]').length).toBe(2);
  });

  it('los listeners no se duplican tras el refresh', () => {
    const onVoiceChange = vi.fn();
    openOptionsSheet({
      showTono: false,
      notation: 'anglo',
      fontLabel: '1.00',
      autoscrollLabel: '50%',
    });
    const { sheet } = openOptionsSheet({
      showTono: false,
      notation: 'anglo',
      fontLabel: '1.00',
      autoscrollLabel: '50%',
      voiceOptions: [{ value: 'tenor', label: 'Tenor' }],
      onVoiceChange,
    });
    sheet.querySelector('[data-voice="tenor"]').click();
    expect(onVoiceChange).toHaveBeenCalledTimes(1);
  });

  it('el refresh actualiza el onClose usado al cerrar', () => {
    const closeA = vi.fn();
    const closeB = vi.fn();
    openOptionsSheet({
      showTono: false,
      notation: 'anglo',
      fontLabel: '1.00',
      autoscrollLabel: '50%',
      onClose: closeA,
    });
    openOptionsSheet({
      showTono: false,
      notation: 'anglo',
      fontLabel: '1.00',
      autoscrollLabel: '50%',
      onClose: closeB,
    });
    closeOptionsSheet();
    expect(closeA).not.toHaveBeenCalled();
    expect(closeB).toHaveBeenCalledTimes(1);
  });
});
