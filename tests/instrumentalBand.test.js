import { describe, it, expect } from 'vitest';
import { InstrumentalBand } from '../src/components/pipeline/lyrics/InstrumentalBand.js';

describe('InstrumentalBand', () => {
  it('pinta el ícono de música y "Solo música"', () => {
    const node = InstrumentalBand({
      section: { type: 'instrumental', startMs: 0, endMs: 1000, lines: [] },
    });
    expect(node.classList.contains('sheet-instrumental')).toBe(true);
    expect(node.textContent).toContain('Solo música');
    expect(node.querySelector('svg')).not.toBeNull();
  });

  it('muestra el rango y la duración en segundos', () => {
    const node = InstrumentalBand({
      section: { type: 'instrumental', startMs: 38000, endMs: 50000, lines: [] },
    });
    const range = node.querySelector('.sheet-instrumental__range');
    expect(range).not.toBeNull();
    expect(range.textContent).toBe('0:38 – 0:50 · 12 s');
  });

  it('sin startMs/endMs no revienta y omite el rango', () => {
    const node = InstrumentalBand({ section: { type: 'instrumental', lines: [] } });
    expect(node.querySelector('.sheet-instrumental__range')).toBeNull();
  });

  it('update(section) refresca el rango sin recrear el nodo', () => {
    const node = InstrumentalBand({
      section: { type: 'instrumental', startMs: 0, endMs: 5000, lines: [] },
    });
    node.update({ type: 'instrumental', startMs: 10000, endMs: 15000, lines: [] });
    expect(node.querySelector('.sheet-instrumental__range').textContent).toBe('0:10 – 0:15 · 5 s');
  });
});
