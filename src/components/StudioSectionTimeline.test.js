/**
 * StudioSectionTimeline.test.js — TDD para renderTimeline y markActive.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderTimeline, markActive } from './StudioSectionTimeline.js';

const SEGS = [
  { label: 'intro', start: 0, end: 10 },
  { label: 'verso', start: 10, end: 40 },
  { label: 'coro', start: 40, end: 70 },
  { label: 'puente', start: 70, end: 80 },
];

describe('renderTimeline', () => {
  it('crea una fila por segmento', () => {
    const el = renderTimeline(SEGS);
    const rows = el.querySelectorAll('.studio-sectl__row');
    expect(rows.length).toBe(4);
  });

  it('cada fila tiene el atributo data-start correcto', () => {
    const el = renderTimeline(SEGS);
    const rows = el.querySelectorAll('.studio-sectl__row');
    expect(rows[0].dataset.start).toBe('0');
    expect(rows[1].dataset.start).toBe('10');
    expect(rows[2].dataset.start).toBe('40');
    expect(rows[3].dataset.start).toBe('70');
  });

  it('cada fila muestra el label en español', () => {
    const el = renderTimeline(SEGS);
    const rows = el.querySelectorAll('.studio-sectl__row');
    expect(rows[0].textContent).toContain('Intro');
    expect(rows[1].textContent).toContain('Verso');
    expect(rows[2].textContent).toContain('Coro');
  });

  it('cada fila muestra el rango m:ss–m:ss con en-dash', () => {
    const el = renderTimeline(SEGS);
    const rows = el.querySelectorAll('.studio-sectl__row');
    // intro: 0:00–0:10
    expect(rows[0].textContent).toContain('0:00–0:10');
    // verso: 0:10–0:40
    expect(rows[1].textContent).toContain('0:10–0:40');
    // coro: 0:40–1:10
    expect(rows[2].textContent).toContain('0:40–1:10');
  });

  it('la barra de color tiene el background de labelColor aplicado', () => {
    const el = renderTimeline([{ label: 'verso', start: 0, end: 10 }]);
    const bar = el.querySelector('.studio-sectl__bar');
    expect(bar).not.toBeNull();
    expect(bar.style.background).toBe('var(--color-primary)');
  });

  it('click en una fila llama onSeek con el start correcto', () => {
    const onSeek = vi.fn();
    const el = renderTimeline(SEGS, { onSeek });
    const rows = el.querySelectorAll('.studio-sectl__row');
    rows[2].click();
    expect(onSeek).toHaveBeenCalledWith(40);
  });

  it('click en la primera fila llama onSeek con 0', () => {
    const onSeek = vi.fn();
    const el = renderTimeline(SEGS, { onSeek });
    el.querySelectorAll('.studio-sectl__row')[0].click();
    expect(onSeek).toHaveBeenCalledWith(0);
  });

  it('sin onSeek: click no tira error', () => {
    const el = renderTimeline(SEGS);
    expect(() => el.querySelectorAll('.studio-sectl__row')[0].click()).not.toThrow();
  });

  it('array vacío → contenedor sin filas y sin leyenda', () => {
    const el = renderTimeline([]);
    expect(el.querySelectorAll('.studio-sectl__row').length).toBe(0);
    expect(el.querySelector('.studio-sectl__legend')).toBeNull();
  });

  it('argumento no-array → contenedor vacío sin error', () => {
    expect(() => renderTimeline(null)).not.toThrow();
    const el = renderTimeline(undefined);
    expect(el.querySelectorAll('.studio-sectl__row').length).toBe(0);
  });

  it('leyenda contiene solo los labels únicos presentes', () => {
    const segs = [
      { label: 'verso', start: 0, end: 10 },
      { label: 'coro', start: 10, end: 20 },
      { label: 'verso', start: 20, end: 30 }, // repetido
    ];
    const el = renderTimeline(segs);
    const legend = el.querySelector('.studio-sectl__legend');
    expect(legend).not.toBeNull();
    // debería haber 2 items únicos: verso y coro
    const items = legend.querySelectorAll('.studio-sectl__legend-item');
    expect(items.length).toBe(2);
  });

  it('cada item de leyenda tiene un swatch con background correcto', () => {
    const el = renderTimeline([{ label: 'coro', start: 0, end: 30 }]);
    const swatch = el.querySelector('.studio-sectl__swatch');
    expect(swatch).not.toBeNull();
    expect(swatch.style.background).toBe('var(--color-accent)');
  });
});

describe('markActive', () => {
  let el;
  beforeEach(() => {
    el = renderTimeline(SEGS);
  });

  it('marca la fila cuyo rango contiene currentTime', () => {
    markActive(el, 15); // dentro de verso (10–40)
    const rows = el.querySelectorAll('.studio-sectl__row');
    expect(rows[1].classList.contains('studio-sectl__row--active')).toBe(true);
  });

  it('desmarca las filas que no contienen currentTime', () => {
    markActive(el, 15);
    const rows = el.querySelectorAll('.studio-sectl__row');
    expect(rows[0].classList.contains('studio-sectl__row--active')).toBe(false);
    expect(rows[2].classList.contains('studio-sectl__row--active')).toBe(false);
    expect(rows[3].classList.contains('studio-sectl__row--active')).toBe(false);
  });

  it('cambia la fila activa cuando currentTime cambia', () => {
    markActive(el, 15); // verso
    markActive(el, 55); // coro (40–70)
    const rows = el.querySelectorAll('.studio-sectl__row');
    expect(rows[1].classList.contains('studio-sectl__row--active')).toBe(false);
    expect(rows[2].classList.contains('studio-sectl__row--active')).toBe(true);
  });

  it('marca la fila en el boundary exacto del start', () => {
    markActive(el, 40); // exactamente inicio de coro
    const rows = el.querySelectorAll('.studio-sectl__row');
    expect(rows[2].classList.contains('studio-sectl__row--active')).toBe(true);
  });

  it('no marca ninguna si currentTime fuera de todos los rangos', () => {
    markActive(el, 999);
    const rows = el.querySelectorAll('.studio-sectl__row');
    rows.forEach(row => {
      expect(row.classList.contains('studio-sectl__row--active')).toBe(false);
    });
  });
});
