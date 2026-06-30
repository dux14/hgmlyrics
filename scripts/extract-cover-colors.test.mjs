import { describe, it, expect } from 'vitest';
import { dominantColors } from './extract-cover-colors.mjs';

describe('dominantColors', () => {
  it('devuelve base y light en hex a partir de un buffer RGB', async () => {
    // 2x2 px solido naranja (#cc6600) en raw RGB
    const px = [0xcc, 0x66, 0x00];
    const raw = Buffer.from([...px, ...px, ...px, ...px]);
    const { base, light } = await dominantColors(raw, 2, 2);
    expect(base).toMatch(/^#[0-9a-f]{6}$/);
    expect(light).toMatch(/^#[0-9a-f]{6}$/);
    expect(base).not.toBe(light); // light es mas claro
  });
});
