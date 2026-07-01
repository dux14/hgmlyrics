import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractCoverColor } from './coverColor.js';

describe('extractCoverColor', () => {
  afterEach(() => vi.restoreAllMocks());

  it('devuelve null si el canvas no entrega contexto (jsdom / lienzo contaminado)', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(extractCoverColor({})).toBeNull();
  });

  it('devuelve null si getImageData lanza (CORS / canvas tainted)', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: () => {},
      getImageData: () => { throw new Error('tainted'); },
    });
    expect(extractCoverColor({})).toBeNull();
  });

  it('extrae un par pastel {base, light} de los pixeles cargados', () => {
    const size = 32;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 0xcc; data[i + 1] = 0x66; data[i + 2] = 0x00; data[i + 3] = 255;
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: () => {},
      getImageData: () => ({ data }),
    });
    const c = extractCoverColor({});
    expect(c.base).toMatch(/^#[0-9a-f]{6}$/);
    expect(c.light).toMatch(/^#[0-9a-f]{6}$/);
    expect(c.base).not.toBe(c.light);
  });
});
