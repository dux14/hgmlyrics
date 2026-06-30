import { describe, it, expect } from 'vitest';
import { dominantColors } from './extract-cover-colors.mjs';

/** Parsea un hex #rrggbb y devuelve luminancia relativa (0-1). */
function lum(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('dominantColors', () => {
  it('devuelve base y light en hex a partir de un buffer RGB', async () => {
    // 2x2 px solido naranja (#cc6600) en raw RGB
    const px = [0xcc, 0x66, 0x00];
    const raw = Buffer.from([...px, ...px, ...px, ...px]);
    const { base, light } = await dominantColors(raw, 2, 2);
    expect(base).toMatch(/^#[0-9a-f]{6}$/);
    expect(light).toMatch(/^#[0-9a-f]{6}$/);
    expect(base).not.toBe(light);
    // light debe ser mas claro que base pero sin blanquearse: si los args
    // h/s/l estuvieran swapeados, l saltaria a 1.0 y el resultado seria
    // #ffffff (lum=1.0); el valor correcto ronda 0.6 para esta entrada.
    expect(lum(light)).toBeGreaterThan(lum(base));
    expect(lum(light)).toBeLessThan(0.95);
  });
});
