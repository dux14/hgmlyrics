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
