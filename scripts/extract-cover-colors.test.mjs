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
  it('devuelve base y light pastel (saturación baja, luminancia media-clara)', async () => {
    // 2x2 px sólido naranja saturado (#cc6600) en raw RGB
    const px = [0xcc, 0x66, 0x00];
    const raw = Buffer.from([...px, ...px, ...px, ...px]);
    const { base, light } = await dominantColors(raw, 2, 2);
    expect(base).toMatch(/^#[0-9a-f]{6}$/);
    expect(light).toMatch(/^#[0-9a-f]{6}$/);
    expect(base).not.toBe(light);
    // Pastel: luminancia de base en banda media-clara, light algo más claro
    // pero sin blanquearse.
    expect(lum(base)).toBeGreaterThan(0.5);
    expect(lum(light)).toBeGreaterThan(lum(base));
    expect(lum(light)).toBeLessThan(0.9);
  });
});
