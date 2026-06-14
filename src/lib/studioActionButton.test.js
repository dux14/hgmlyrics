import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createActionButton } from './studioActionButton.js';

function mountButton() {
  document.body.innerHTML = '<button id="b"></button>';
  return document.getElementById('b');
}

describe('createActionButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('pinta el estado idle: icono + label, sin clases de estado', () => {
    const btn = mountButton();
    createActionButton(btn, { idle: { icon: 'download', label: 'Descargar todo (ZIP)' } });
    expect(btn.querySelector('.studio-action__lbl').textContent).toBe('Descargar todo (ZIP)');
    expect(btn.querySelector('.studio-action__ico svg')).toBeTruthy();
    expect(btn.querySelector('.studio-action__fill')).toBeTruthy();
    expect(btn.classList.contains('is-busy')).toBe(false);
  });

  it('.busy(label) marca is-busy y cambia el label', () => {
    const btn = mountButton();
    const ctrl = createActionButton(btn, { idle: { icon: 'download', label: 'ZIP' } });
    ctrl.busy('Empaquetando');
    expect(btn.classList.contains('is-busy')).toBe(true);
    expect(btn.querySelector('.studio-action__lbl').textContent).toBe('Empaquetando');
  });

  it('.progress(fraction) fija el ancho del fill en porcentaje y lo clampa a 0..1', () => {
    const btn = mountButton();
    const ctrl = createActionButton(btn, { idle: { icon: 'download', label: 'ZIP' } });
    ctrl.busy('Empaquetando');
    ctrl.progress(0.25);
    expect(btn.querySelector('.studio-action__fill').style.width).toBe('25%');
    ctrl.progress(2);
    expect(btn.querySelector('.studio-action__fill').style.width).toBe('100%');
    ctrl.progress(-1);
    expect(btn.querySelector('.studio-action__fill').style.width).toBe('0%');
  });

  it('.done(label) marca is-done, pone el icono check-circle y restaura idle tras el timer', () => {
    vi.useFakeTimers();
    const btn = mountButton();
    const ctrl = createActionButton(btn, { idle: { icon: 'download', label: 'ZIP' } });
    ctrl.busy('Empaquetando');
    ctrl.done('Listo');
    expect(btn.classList.contains('is-done')).toBe(true);
    expect(btn.classList.contains('is-busy')).toBe(false);
    expect(btn.querySelector('.studio-action__lbl').textContent).toBe('Listo');
    vi.advanceTimersByTime(2000);
    expect(btn.classList.contains('is-done')).toBe(false);
    expect(btn.querySelector('.studio-action__lbl').textContent).toBe('ZIP');
  });

  it('.error() marca is-error, label "Reintentar" e icono rotate-ccw', () => {
    const btn = mountButton();
    const ctrl = createActionButton(btn, { idle: { icon: 'download', label: 'ZIP' } });
    ctrl.busy('Empaquetando');
    ctrl.error();
    expect(btn.classList.contains('is-error')).toBe(true);
    expect(btn.classList.contains('is-busy')).toBe(false);
    expect(btn.querySelector('.studio-action__lbl').textContent).toBe('Reintentar');
  });

  it('.reset() vuelve a idle limpiando estado y fill', () => {
    const btn = mountButton();
    const ctrl = createActionButton(btn, { idle: { icon: 'download', label: 'ZIP' } });
    ctrl.busy('Empaquetando');
    ctrl.progress(0.5);
    ctrl.reset();
    expect(btn.className).toBe('studio-action');
    expect(btn.querySelector('.studio-action__lbl').textContent).toBe('ZIP');
    expect(btn.querySelector('.studio-action__fill').style.width).toBe('0%');
  });
});
