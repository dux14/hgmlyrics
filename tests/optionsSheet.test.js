import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  openOptionsSheet,
  closeOptionsSheet,
  isOptionsSheetOpen,
} from '../src/components/OptionsSheet.js';

function flushClose() {
  // El desmontaje ocurre tras animationend o el timeout de respaldo (~200ms).
  vi.advanceTimersByTime(250);
}

afterEach(() => {
  // Libera el singleton entre tests (mismo patrón que GoToSheet): sin esto,
  // una hoja abierta y no cerrada en un test deja `openEls` vivo y el
  // siguiente `openOptionsSheet` no monta nada nuevo.
  vi.useFakeTimers();
  closeOptionsSheet();
  flushClose();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('openOptionsSheet — montaje', () => {
  it('showTono=false oculta la sección Tono', () => {
    openOptionsSheet({ showTono: false });
    expect(document.querySelector('#osheet-tono')).toBeNull();
  });

  it('notación refleja el segmento activo', () => {
    openOptionsSheet({ showTono: false, notation: 'anglo' });
    const anglo = document.querySelector('[data-notation="anglo"]');
    const latin = document.querySelector('[data-notation="latin"]');
    expect(anglo.classList.contains('is-active')).toBe(true);
    expect(anglo.getAttribute('aria-pressed')).toBe('true');
    expect(latin.classList.contains('is-active')).toBe(false);
  });
});

describe('openOptionsSheet — interacción', () => {
  it('cambiar notación activa el botón clicado y dispara onNotationChange', () => {
    const onNotationChange = vi.fn();
    openOptionsSheet({ showTono: false, notation: 'latin', onNotationChange });
    document.querySelector('[data-notation="anglo"]').click();
    expect(onNotationChange).toHaveBeenCalledWith('anglo');
    expect(document.querySelector('[data-notation="anglo"]').classList.contains('is-active')).toBe(
      true,
    );
    expect(document.querySelector('[data-notation="latin"]').classList.contains('is-active')).toBe(
      false,
    );
  });

  it('stepper de tono dispara onTranspose(1)/onTranspose(-1), bubble dispara onResetTranspose', () => {
    const onTranspose = vi.fn();
    const onResetTranspose = vi.fn();
    openOptionsSheet({
      showTono: true,
      tonoLabel: '+2',
      onTranspose,
      onResetTranspose,
    });
    document.querySelector('[data-act="tup"]').click();
    document.querySelector('[data-act="tdown"]').click();
    document.querySelector('[data-act="treset"]').click();
    expect(onTranspose).toHaveBeenNthCalledWith(1, 1);
    expect(onTranspose).toHaveBeenNthCalledWith(2, -1);
    expect(onResetTranspose).toHaveBeenCalledTimes(1);
  });

  it('A−/A+ disparan onFont con la dirección correcta', () => {
    const onFont = vi.fn();
    openOptionsSheet({ showTono: false, onFont });
    document.querySelector('[data-act="fup"]').click();
    document.querySelector('[data-act="fdown"]').click();
    expect(onFont).toHaveBeenNthCalledWith(1, 1);
    expect(onFont).toHaveBeenNthCalledWith(2, -1);
  });

  it('showMetronome=false oculta la sección METRÓNOMO', () => {
    openOptionsSheet({ showTono: false, showMetronome: false });
    expect(document.querySelector('#osheet-metronome-audio')).toBeNull();
    expect(document.querySelector('#osheet-metronome-visual')).toBeNull();
  });

  it('showMetronome=true pinta los dos toggles reflejando metronomeAudioOn/metronomeVisualOn', () => {
    openOptionsSheet({
      showTono: false,
      showMetronome: true,
      metronomeAudioOn: true,
      metronomeVisualOn: true,
    });
    const audioBtn = document.querySelector('#osheet-metronome-audio');
    const visualBtn = document.querySelector('#osheet-metronome-visual');
    expect(audioBtn).toBeTruthy();
    expect(audioBtn.classList.contains('is-active')).toBe(true);
    expect(audioBtn.getAttribute('aria-pressed')).toBe('true');
    expect(audioBtn.textContent).toBe('Sonido: activado');
    expect(visualBtn).toBeTruthy();
    expect(visualBtn.classList.contains('is-active')).toBe(true);
    expect(visualBtn.getAttribute('aria-pressed')).toBe('true');
    expect(visualBtn.textContent).toBe('Guía visual: activada');
  });

  it('showMetronome=true muestra los labels apagados cuando metronomeAudioOn/metronomeVisualOn son false', () => {
    openOptionsSheet({
      showTono: false,
      showMetronome: true,
      metronomeAudioOn: false,
      metronomeVisualOn: false,
    });
    expect(document.querySelector('#osheet-metronome-audio').textContent).toBe(
      'Sonido: silenciado',
    );
    expect(document.querySelector('#osheet-metronome-visual').textContent).toBe(
      'Guía visual: oculta',
    );
  });

  it('toggle de sonido dispara onMetronomeAudioToggle con el nuevo estado', () => {
    const onMetronomeAudioToggle = vi.fn();
    openOptionsSheet({
      showTono: false,
      showMetronome: true,
      metronomeAudioOn: false,
      metronomeVisualOn: true,
      onMetronomeAudioToggle,
    });
    const btn = document.querySelector('[data-act="metronome-audio-toggle"]');
    btn.click();
    expect(onMetronomeAudioToggle).toHaveBeenCalledWith(true);
    expect(btn.textContent).toBe('Sonido: activado');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('toggle de guía visual dispara onMetronomeVisualToggle con el nuevo estado', () => {
    const onMetronomeVisualToggle = vi.fn();
    openOptionsSheet({
      showTono: false,
      showMetronome: true,
      metronomeAudioOn: false,
      metronomeVisualOn: true,
      onMetronomeVisualToggle,
    });
    const btn = document.querySelector('[data-act="metronome-visual-toggle"]');
    btn.click();
    expect(onMetronomeVisualToggle).toHaveBeenCalledWith(false);
    expect(btn.textContent).toBe('Guía visual: oculta');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('sección METRÓNOMO muestra el título "Metrónomo" (dos toggles, sin hint de guía visual aparte)', () => {
    openOptionsSheet({
      showTono: false,
      showMetronome: true,
      metronomeAudioOn: true,
      metronomeVisualOn: true,
    });
    const headers = Array.from(document.querySelectorAll('.osheet__h')).map((h) => h.textContent);
    expect(headers).toContain('Metrónomo');
    expect(document.querySelector('.osheet__hint')).toBeNull();
  });

  it('#osheet-player muestra el label dinámico según playerOn', () => {
    openOptionsSheet({ showTono: false, showPlayerToggle: true, playerOn: true });
    expect(document.querySelector('#osheet-player').textContent).toBe('Pista: sonando');
  });

  it('#osheet-player muestra "Pista: en pausa" cuando playerOn es false', () => {
    openOptionsSheet({ showTono: false, showPlayerToggle: true, playerOn: false });
    expect(document.querySelector('#osheet-player').textContent).toBe('Pista: en pausa');
  });

  it('velocidad autoscroll dispara onAutoscroll y actualiza el valor mostrado', () => {
    const onAutoscroll = vi.fn().mockReturnValue('75%');
    openOptionsSheet({
      showTono: false,
      autoscrollLabel: '50%',
      onAutoscroll,
    });
    document.querySelector('[data-act="asup"]').click();
    expect(onAutoscroll).toHaveBeenCalledWith(1);
    expect(document.querySelector('#osheet-autoscroll').textContent).toBe('75%');
  });

  it('click en el overlay cierra el sheet y llama onClose', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    openOptionsSheet({ showTono: false, onClose });
    document.querySelector('.osheet-dim').click();
    flushClose();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.osheet')).toBeNull();
  });

  it('Escape cierra el sheet', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    openOptionsSheet({ showTono: false, onClose });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushClose();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.osheet')).toBeNull();
  });

  it('singleton: abrir mientras ya hay una hoja abierta no monta una segunda', () => {
    vi.useFakeTimers();
    openOptionsSheet({ showTono: false });
    expect(isOptionsSheetOpen()).toBe(true);
    openOptionsSheet({ showTono: false });
    expect(document.querySelectorAll('.osheet')).toHaveLength(1);
    closeOptionsSheet();
    flushClose();
    expect(isOptionsSheetOpen()).toBe(false);
  });
});
