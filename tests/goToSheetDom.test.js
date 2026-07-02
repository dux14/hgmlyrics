import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../src/router.js', () => ({ navigate: vi.fn() }));
vi.mock('../src/lib/cacheClear.js', () => ({ clearAppCache: vi.fn() }));

import { navigate } from '../src/router.js';
import { clearAppCache } from '../src/lib/cacheClear.js';
import {
  GO_TO_TILES,
  openGoToSheet,
  closeGoToSheet,
  isGoToSheetOpen,
} from '../src/components/GoToSheet.js';

function flushClose() {
  // El desmontaje ocurre tras animationend o el timeout de respaldo (~200ms).
  vi.advanceTimersByTime(250);
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  document.body.classList.remove('menu-open');
  vi.clearAllMocks();
});

describe('openGoToSheet — montaje', () => {
  it('monta .gsheet con una fila por tile', () => {
    vi.useFakeTimers();
    openGoToSheet();
    const rows = document.querySelectorAll('.gsheet__row');
    expect(rows).toHaveLength(GO_TO_TILES.length);
    rows.forEach((row) => {
      expect(row.querySelector('.gsheet__ic')).toBeTruthy();
      expect(row.querySelector('.gsheet__label')).toBeTruthy();
      expect(row.querySelector('.gsheet__desc')).toBeTruthy();
    });
    closeGoToSheet();
    flushClose();
  });

  it('añade menu-open al body al abrir', () => {
    vi.useFakeTimers();
    openGoToSheet();
    expect(document.body.classList.contains('menu-open')).toBe(true);
    closeGoToSheet();
    flushClose();
  });

  it('quita menu-open del body al cerrar', () => {
    vi.useFakeTimers();
    openGoToSheet();
    closeGoToSheet();
    flushClose();
    expect(document.body.classList.contains('menu-open')).toBe(false);
  });

  it('doble apertura es idempotente (una sola .gsheet)', () => {
    vi.useFakeTimers();
    openGoToSheet();
    openGoToSheet();
    expect(document.querySelectorAll('.gsheet')).toHaveLength(1);
    closeGoToSheet();
    flushClose();
  });

  it('isGoToSheetOpen refleja el estado', () => {
    vi.useFakeTimers();
    expect(isGoToSheetOpen()).toBe(false);
    openGoToSheet();
    expect(isGoToSheetOpen()).toBe(true);
    closeGoToSheet();
    flushClose();
    expect(isGoToSheetOpen()).toBe(false);
  });
});

describe('openGoToSheet — cierre', () => {
  it('Escape cierra y llama onClose una vez', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    openGoToSheet('', { onClose });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushClose();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.gsheet')).toBeNull();
  });

  it('closeGoToSheet() cierra y llama onClose', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    openGoToSheet('', { onClose });
    closeGoToSheet();
    flushClose();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.gsheet')).toBeNull();
  });

  it('closeGoToSheet() sin hoja abierta es no-op', () => {
    expect(() => closeGoToSheet()).not.toThrow();
  });

  it('click en el dim cierra la hoja', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    openGoToSheet('', { onClose });
    document.querySelector('.gsheet-dim').click();
    flushClose();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('click en fila con data-route navega y cierra', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    openGoToSheet('', { onClose });
    const row = document.querySelector('[data-route="/albumes"]');
    row.click();
    flushClose();
    expect(navigate).toHaveBeenCalledWith('/albumes');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.gsheet')).toBeNull();
  });

  it('click en fila con data-action ejecuta la acción y cierra', async () => {
    vi.useFakeTimers();
    openGoToSheet();
    const row = document.querySelector('[data-action="clearCache"]');
    row.click();
    // Deja correr microtasks pendientes (import dinámico) antes de avanzar timers.
    await vi.runOnlyPendingTimersAsync().catch(() => {});
    flushClose();
    expect(clearAppCache).toHaveBeenCalled();
  });

  it('remueve el listener de Escape tras cerrar', () => {
    vi.useFakeTimers();
    openGoToSheet();
    closeGoToSheet();
    flushClose();
    // Un segundo Escape tras cerrar no debe lanzar ni reabrir nada.
    expect(() =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
    ).not.toThrow();
    expect(document.querySelector('.gsheet')).toBeNull();
  });
});
