import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showToast } from '../src/lib/toast.js';

describe('showToast', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('crea un único nodo .toast en document.body con clase visible y texto', () => {
    showToast('Hola');
    const toasts = document.querySelectorAll('.toast');
    expect(toasts.length).toBe(1);
    expect(toasts[0].classList.contains('visible')).toBe(true);
    expect(toasts[0].textContent).toBe('Hola');
  });

  it('reusa el nodo en una segunda llamada', () => {
    showToast('Hola');
    showToast('Adiós');
    const toasts = document.querySelectorAll('.toast');
    expect(toasts.length).toBe(1);
    expect(toasts[0].textContent).toBe('Adiós');
  });

  it('agrega .toast--error con type error y la quita en una llamada success posterior', () => {
    showToast('Falló', { type: 'error' });
    let toast = document.querySelector('.toast');
    expect(toast.classList.contains('toast--error')).toBe(true);

    showToast('Todo bien');
    toast = document.querySelector('.toast');
    expect(toast.classList.contains('toast--error')).toBe(false);
  });

  it('el nodo tiene aria-live="polite"', () => {
    showToast('Hola');
    const toast = document.querySelector('.toast');
    expect(toast.getAttribute('aria-live')).toBe('polite');
  });

  it('pierde la clase visible tras el timeout', () => {
    showToast('Hola', { duration: 1000 });
    const toast = document.querySelector('.toast');
    expect(toast.classList.contains('visible')).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(toast.classList.contains('visible')).toBe(false);
  });
});
