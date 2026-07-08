import { describe, it, expect, afterEach } from 'vitest';
import { confirmDialog } from '../src/components/ConfirmDialog.js';

function overlayEl() {
  return document.querySelector('.import-modal__overlay');
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('confirmDialog', () => {
  it('monta overlay en document.body con título y cuerpo', () => {
    confirmDialog({ title: 'T', body: 'B', confirmLabel: 'Sí' });
    const overlay = overlayEl();
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toContain('T');
    expect(overlay.textContent).toContain('B');
  });

  it('click en confirmar resuelve true y desmonta', async () => {
    const p = confirmDialog({ title: 'T', body: 'B', confirmLabel: 'Sí' });
    overlayEl().querySelector('[data-confirm="yes"]').click();
    await expect(p).resolves.toBe(true);
    expect(overlayEl()).toBeNull();
  });

  it('click en cancelar resuelve false y desmonta', async () => {
    const p = confirmDialog({ title: 'T', body: 'B' });
    overlayEl().querySelector('[data-confirm="no"]').click();
    await expect(p).resolves.toBe(false);
    expect(overlayEl()).toBeNull();
  });

  it('Escape resuelve false y desmonta', async () => {
    const p = confirmDialog({ title: 'T', body: 'B' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(p).resolves.toBe(false);
    expect(overlayEl()).toBeNull();
  });

  it('click en el overlay (fuera de la caja) resuelve false', async () => {
    const p = confirmDialog({ title: 'T', body: 'B' });
    overlayEl().click();
    await expect(p).resolves.toBe(false);
    expect(overlayEl()).toBeNull();
  });

  it('danger: true agrega clase modificadora al botón confirmar', () => {
    confirmDialog({ title: 'T', body: 'B', danger: true });
    const btn = overlayEl().querySelector('[data-confirm="yes"]');
    expect(btn.classList.contains('btn--danger')).toBe(true);
  });

  it('sin danger no agrega la clase modificadora', () => {
    confirmDialog({ title: 'T', body: 'B' });
    const btn = overlayEl().querySelector('[data-confirm="yes"]');
    expect(btn.classList.contains('btn--danger')).toBe(false);
  });

  it('al abrir, el focus queda en el botón cancelar', () => {
    confirmDialog({ title: 'T', body: 'B' });
    const cancelBtn = overlayEl().querySelector('[data-confirm="no"]');
    expect(document.activeElement).toBe(cancelBtn);
  });

  it('usa labels por defecto si no se pasan', () => {
    confirmDialog({ title: 'T', body: 'B' });
    const overlay = overlayEl();
    expect(overlay.querySelector('[data-confirm="no"]').textContent).toBe('Cancelar');
    expect(overlay.querySelector('[data-confirm="yes"]').textContent).toBe('Confirmar');
  });

  it('cleanup: remueve el listener de teclado tras cerrar (Escape posterior no rompe)', async () => {
    const p = confirmDialog({ title: 'T', body: 'B' });
    overlayEl().querySelector('[data-confirm="yes"]').click();
    await p;
    expect(() =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
    ).not.toThrow();
  });

  it('devuelve el focus al elemento que lo invocó', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const p = confirmDialog({ title: 'T', body: 'B' });
    overlayEl().querySelector('[data-confirm="no"]').click();
    await p;
    expect(document.activeElement).toBe(trigger);
  });
});
