import { describe, it, expect } from 'vitest';
import { icon } from './icons.js';

describe('icon(gospel)', () => {
  it('devuelve SVG no vacío con el path del libro', () => {
    const svg = icon('gospel', { size: 24 });
    expect(svg).toContain('<svg');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('M3 6.5'); // arranque del path del libro
  });
});
