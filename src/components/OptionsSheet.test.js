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

describe('focus trap y retorno de foco (a11y)', () => {
  function baseOpts(extra = {}) {
    return {
      showTono: true,
      tonoLabel: '0 · Original',
      useFlats: false,
      notation: 'latin',
      fontLabel: '1.00',
      autoscrollLabel: '50%',
      ...extra,
    };
  }

  function tabEvent(shiftKey = false) {
    return new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, shiftKey });
  }

  it('al abrir, el foco pasa al sheet', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Abrir opciones';
    document.body.append(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    openOptionsSheet(baseOpts());

    expect(document.activeElement.classList.contains('osheet')).toBe(true);
  });

  it('Tab desde el último focusable cicla al primero', () => {
    openOptionsSheet(baseOpts());
    const sheet = document.querySelector('.osheet');
    const focusables = sheet.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    last.focus();
    document.dispatchEvent(tabEvent(false));

    expect(document.activeElement).toBe(first);
  });

  it('Shift+Tab desde el primer focusable cicla al último', () => {
    openOptionsSheet(baseOpts());
    const sheet = document.querySelector('.osheet');
    const focusables = sheet.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    first.focus();
    document.dispatchEvent(tabEvent(true));

    expect(document.activeElement).toBe(last);
  });

  it('al cerrar (reduce-motion), el foco vuelve al elemento que abrió el sheet', () => {
    window.matchMedia = () => ({ matches: true });

    const opener = document.createElement('button');
    opener.textContent = 'Abrir opciones';
    document.body.append(opener);
    opener.focus();

    openOptionsSheet(baseOpts());
    expect(document.activeElement.classList.contains('osheet')).toBe(true);

    closeOptionsSheet();

    expect(document.activeElement).toBe(opener);

    delete window.matchMedia;
  });

  it('si el opener fue removido del DOM antes de cerrar, no lanza y no intenta enfocarlo', () => {
    window.matchMedia = () => ({ matches: true });

    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();

    openOptionsSheet(baseOpts());
    opener.remove();
    const focusSpy = vi.spyOn(opener, 'focus');

    expect(() => closeOptionsSheet()).not.toThrow();
    // El guard opener?.isConnected evita reenfocar un nodo desconectado.
    expect(focusSpy).not.toHaveBeenCalled();

    delete window.matchMedia;
  });

  it('reapertura idempotente (update) no pisa el opener original', () => {
    window.matchMedia = () => ({ matches: true });

    const opener = document.createElement('button');
    opener.textContent = 'Abrir opciones';
    document.body.append(opener);
    opener.focus();

    openOptionsSheet(baseOpts());

    const otherButton = document.createElement('button');
    document.body.append(otherButton);
    otherButton.focus();
    // Reapertura idempotente: ya hay hoja abierta, dispara `update` en vez de
    // recrear el sheet; el opener capturado en la apertura original NO debe
    // ser reemplazado por `otherButton`.
    openOptionsSheet(baseOpts({ fontLabel: '1.10' }));

    closeOptionsSheet();

    expect(document.activeElement).toBe(opener);

    delete window.matchMedia;
  });
});

describe('OptionsSheet — sección metrónomo (TANDA B, toggle maestro)', () => {
  it('título "Metrónomo", labels Activado/Desactivado y sin el hint de guía visual', () => {
    openOptionsSheet({
      showTono: false,
      notation: 'anglo',
      fontLabel: '1.00',
      autoscrollLabel: '50%',
      showMetronome: true,
      metronomeOn: true,
    });

    const headers = Array.from(document.querySelectorAll('.osheet__h')).map((h) => h.textContent);
    expect(headers).toContain('Metrónomo');
    expect(headers).not.toContain('Click del metrónomo');
    expect(document.querySelector('#osheet-metronome').textContent).toBe('Activado');
    expect(document.querySelector('.osheet__hint')).toBeNull();
  });

  it('metronomeOn false renderiza el label Desactivado', () => {
    openOptionsSheet({
      showTono: false,
      notation: 'anglo',
      fontLabel: '1.00',
      autoscrollLabel: '50%',
      showMetronome: true,
      metronomeOn: false,
    });

    expect(document.querySelector('#osheet-metronome').textContent).toBe('Desactivado');
  });

  it('el click del botón alterna a Activado/Desactivado y llama a onMetronomeToggle', () => {
    const onMetronomeToggle = vi.fn();
    openOptionsSheet({
      showTono: false,
      notation: 'anglo',
      fontLabel: '1.00',
      autoscrollLabel: '50%',
      showMetronome: true,
      metronomeOn: false,
      onMetronomeToggle,
    });

    document.querySelector('#osheet-metronome').click();

    expect(document.querySelector('#osheet-metronome').textContent).toBe('Activado');
    expect(onMetronomeToggle).toHaveBeenCalledWith(true);
  });
});
