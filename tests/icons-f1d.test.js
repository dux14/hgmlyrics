import { describe, it, expect } from 'vitest';
import { icon } from '../src/lib/icons.js';

describe('iconos F1d', () => {
  it('maximize devuelve SVG con path', () => {
    const svg = icon('maximize', { size: 22 });
    expect(svg).toContain('<svg');
    expect(svg).toContain('width="22"');
    expect(svg).toContain('<path');
  });
  it('sun devuelve SVG no vacío', () => {
    const svg = icon('sun', { size: 18 });
    expect(svg).toContain('<svg');
    expect(svg).not.toBe('');
  });
});
