import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  openSongActionsSheet,
  closeSongActionsSheet,
  isSongActionsSheetOpen,
} from '../src/components/SongActionsSheet.js';

function flushClose() {
  // El desmontaje ocurre tras animationend o el timeout de respaldo (~200ms) —
  // mismo patrón que optionsSheet.test.js.
  vi.advanceTimersByTime(250);
}

afterEach(() => {
  vi.useFakeTimers();
  closeSongActionsSheet();
  flushClose();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('openSongActionsSheet — montaje', () => {
  it('es un dialog accesible', () => {
    openSongActionsSheet({ items: [{ id: 'a', icon: 'pencil', label: 'Editar canción' }] });
    const sheet = document.querySelector('.sasheet');
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.getAttribute('aria-modal')).toBe('true');
  });

  it('pinta un item por entrada, con label y sub-label opcional', () => {
    openSongActionsSheet({
      items: [
        { id: 'edit-song', icon: 'pencil', label: 'Editar canción' },
        { id: 'pipeline', icon: 'activity', label: 'Procesamiento', subLabel: 'En proceso' },
      ],
    });
    const items = document.querySelectorAll('.sasheet__item');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('Editar canción');
    expect(items[1].textContent).toContain('Procesamiento');
    expect(items[1].textContent).toContain('En proceso');
  });

  it('sin items no pinta ninguno', () => {
    openSongActionsSheet({ items: [] });
    expect(document.querySelectorAll('.sasheet__item').length).toBe(0);
  });
});

describe('openSongActionsSheet — interacción', () => {
  it('clic en un item dispara su onClick y cierra la hoja', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    openSongActionsSheet({
      items: [{ id: 'estudio', icon: 'audio-lines', label: 'Estudio', onClick }],
    });
    document.querySelector('[data-sasheet-item="estudio"]').click();
    expect(onClick).toHaveBeenCalledTimes(1);
    flushClose();
    expect(document.querySelector('.sasheet')).toBeNull();
    vi.useRealTimers();
  });

  it('reapertura mientras está abierta actualiza el contenido (singleton)', () => {
    openSongActionsSheet({ items: [{ id: 'a', icon: 'pencil', label: 'Editar canción' }] });
    expect(isSongActionsSheetOpen()).toBe(true);
    openSongActionsSheet({ items: [{ id: 'b', icon: 'music', label: 'Partitura' }] });
    expect(document.querySelectorAll('.sasheet__item').length).toBe(1);
    expect(document.querySelector('[data-sasheet-item="b"]')).toBeTruthy();
  });

  it('Escape cierra la hoja', () => {
    vi.useFakeTimers();
    openSongActionsSheet({ items: [{ id: 'a', icon: 'pencil', label: 'Editar canción' }] });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushClose();
    expect(isSongActionsSheetOpen()).toBe(false);
    vi.useRealTimers();
  });

  it('clic en el backdrop cierra la hoja', () => {
    vi.useFakeTimers();
    openSongActionsSheet({ items: [{ id: 'a', icon: 'pencil', label: 'Editar canción' }] });
    document.querySelector('.sasheet-dim').click();
    flushClose();
    expect(isSongActionsSheetOpen()).toBe(false);
    vi.useRealTimers();
  });

  it('restaura el foco al elemento que abrió la hoja', () => {
    vi.useFakeTimers();
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    openSongActionsSheet({ items: [{ id: 'a', icon: 'pencil', label: 'Editar canción' }] });
    closeSongActionsSheet();
    flushClose();
    expect(document.activeElement).toBe(opener);
    vi.useRealTimers();
  });
});
