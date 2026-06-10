/**
 * avatarSprite.test.js — Tests de las funciones puras de avatarSprite.js.
 *
 * No testea la carga Phaser (jsdom no tiene WebGL); eso queda para el gate
 * manual. Solo verifica la lógica de índices de frames y la URL pública.
 */
import { describe, it, expect } from 'vitest';
import {
  dirRow,
  standingFrame,
  walkFrames,
  publicAvatarUrl,
} from '../../src/world/avatarSprite.js';

// Manifest LPC: 4 filas, 9 columnas
const ROW_DIR = ['up', 'left', 'down', 'right'];
const COLS = 9;

// ─── dirRow ─────────────────────────────────────────────────────────────────

describe('dirRow', () => {
  it('up → fila 0', () => {
    expect(dirRow('up', ROW_DIR)).toBe(0);
  });

  it('left → fila 1', () => {
    expect(dirRow('left', ROW_DIR)).toBe(1);
  });

  it('down → fila 2', () => {
    expect(dirRow('down', ROW_DIR)).toBe(2);
  });

  it('right → fila 3', () => {
    expect(dirRow('right', ROW_DIR)).toBe(3);
  });

  it('dirección desconocida → fila de down (2)', () => {
    expect(dirRow('unknown', ROW_DIR)).toBe(2);
  });

  it('usa rowDir default (up/left/down/right) si se omite', () => {
    expect(dirRow('right')).toBe(3);
    expect(dirRow('up')).toBe(0);
  });
});

// ─── standingFrame ──────────────────────────────────────────────────────────

describe('standingFrame', () => {
  it('up: fila 0, columna 0 → frame 0', () => {
    expect(standingFrame('up', COLS, ROW_DIR)).toBe(0);
  });

  it('left: fila 1, columna 0 → frame 9', () => {
    expect(standingFrame('left', COLS, ROW_DIR)).toBe(9);
  });

  it('down: fila 2, columna 0 → frame 18', () => {
    expect(standingFrame('down', COLS, ROW_DIR)).toBe(18);
  });

  it('right: fila 3, columna 0 → frame 27', () => {
    expect(standingFrame('right', COLS, ROW_DIR)).toBe(27);
  });

  it('usa defaults (cols=9, up/left/down/right) si se omiten parámetros', () => {
    expect(standingFrame('down')).toBe(18);
  });
});

// ─── walkFrames ─────────────────────────────────────────────────────────────

describe('walkFrames', () => {
  it('up: frames 1..8 (8 frames)', () => {
    expect(walkFrames('up', COLS, ROW_DIR)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('left: frames 10..17 (fila 1, cols 1-8)', () => {
    expect(walkFrames('left', COLS, ROW_DIR)).toEqual([10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it('down: frames 19..26 (fila 2, cols 1-8)', () => {
    expect(walkFrames('down', COLS, ROW_DIR)).toEqual([19, 20, 21, 22, 23, 24, 25, 26]);
  });

  it('right: frames 28..35 (fila 3, cols 1-8)', () => {
    expect(walkFrames('right', COLS, ROW_DIR)).toEqual([28, 29, 30, 31, 32, 33, 34, 35]);
  });

  it('cada dirección devuelve exactamente 8 frames', () => {
    ROW_DIR.forEach((dir) => {
      expect(walkFrames(dir, COLS, ROW_DIR)).toHaveLength(8);
    });
  });

  it('el primer frame de walk es standingFrame + 1', () => {
    ROW_DIR.forEach((dir) => {
      const walk = walkFrames(dir, COLS, ROW_DIR);
      expect(walk[0]).toBe(standingFrame(dir, COLS, ROW_DIR) + 1);
    });
  });

  it('usa defaults (cols=9, up/left/down/right) si se omiten parámetros', () => {
    expect(walkFrames('right')).toEqual([28, 29, 30, 31, 32, 33, 34, 35]);
  });
});

// ─── publicAvatarUrl ─────────────────────────────────────────────────────────

describe('publicAvatarUrl', () => {
  it('llama a supabase.storage.from("avatars").getPublicUrl con "{uid}.png"', () => {
    const fakeUrl = 'https://supabase.example.com/storage/v1/object/public/avatars/user-123.png';
    const fakeSupabase = {
      storage: {
        from: (bucket) => ({
          getPublicUrl: (path) => ({
            data: {
              publicUrl: `https://supabase.example.com/storage/v1/object/public/${bucket}/${path}`,
            },
          }),
        }),
      },
    };

    const result = publicAvatarUrl(fakeSupabase, 'user-123');
    expect(result).toBe(fakeUrl);
  });

  it('usa exactamente el bucket "avatars"', () => {
    let capturedBucket = null;
    const fakeSupabase = {
      storage: {
        from: (bucket) => {
          capturedBucket = bucket;
          return {
            getPublicUrl: () => ({ data: { publicUrl: 'https://example.com/x.png' } }),
          };
        },
      },
    };

    publicAvatarUrl(fakeSupabase, 'abc');
    expect(capturedBucket).toBe('avatars');
  });

  it('la ruta del archivo es "{uid}.png"', () => {
    let capturedPath = null;
    const fakeSupabase = {
      storage: {
        from: () => ({
          getPublicUrl: (path) => {
            capturedPath = path;
            return { data: { publicUrl: 'https://example.com/x.png' } };
          },
        }),
      },
    };

    publicAvatarUrl(fakeSupabase, 'my-uid-456');
    expect(capturedPath).toBe('my-uid-456.png');
  });
});
