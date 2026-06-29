import { describe, it, expect } from 'vitest';
import {
  canTransition,
  DAILY_QUOTA,
  ACTIVE_STATUSES,
  expiresAt,
  validateUploadMeta,
  sanitizeTitle,
} from '../api/_lib/stems.js';

describe('canTransition', () => {
  it('permite el camino feliz completo', () => {
    expect(canTransition('created', 'uploaded')).toBe(true);
    expect(canTransition('created', 'processing')).toBe(true); // salto directo de start.js
    expect(canTransition('uploaded', 'processing')).toBe(true);
    expect(canTransition('processing', 'done')).toBe(true);
    expect(canTransition('processing', 'partial')).toBe(true);
    expect(canTransition('partial', 'done')).toBe(true);
    expect(canTransition('done', 'expired')).toBe(true);
  });

  it('permite failed desde estados en proceso, no desde done', () => {
    expect(canTransition('processing', 'failed')).toBe(true);
    expect(canTransition('partial', 'failed')).toBe(true);
    expect(canTransition('done', 'failed')).toBe(false);
  });

  it('rechaza retrocesos, estados v1 eliminados y estados desconocidos', () => {
    expect(canTransition('expired', 'done')).toBe(false);
    expect(canTransition('nope', 'done')).toBe(false);
    // separating_stems/separating_voices eliminados en Task 0.7
    expect(canTransition('created', 'separating_stems')).toBe(false);
    expect(canTransition('separating_stems', 'separating_voices')).toBe(false);
  });
});

describe('expiresAt', () => {
  it('devuelve created + 48h', () => {
    const base = new Date('2026-06-03T10:00:00Z');
    expect(expiresAt(base).toISOString()).toBe('2026-06-05T10:00:00.000Z');
  });
});

describe('validateUploadMeta', () => {
  const ok = { filename: 'cancion.mp3', size: 10 * 1024 * 1024, mime: 'audio/mpeg' };

  it('acepta un mp3 de 10MB', () => {
    expect(() => validateUploadMeta(ok)).not.toThrow();
  });

  it('rechaza > 25MB con status 400', () => {
    expect(() => validateUploadMeta({ ...ok, size: 26 * 1024 * 1024 })).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('rechaza mime no-audio', () => {
    expect(() => validateUploadMeta({ ...ok, mime: 'application/pdf' })).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('rechaza filename vacío', () => {
    expect(() => validateUploadMeta({ ...ok, filename: '' })).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });
});

describe('sanitizeTitle', () => {
  it('recorta espacios y respeta el título dado', () => {
    expect(sanitizeTitle('  Mi canción  ', 'archivo.mp3')).toBe('Mi canción');
  });
  it('cae al filename sin extensión si el título es vacío', () => {
    expect(sanitizeTitle('   ', 'colombia.mp3')).toBe('colombia');
    expect(sanitizeTitle(undefined, 'colombia.mp3')).toBe('colombia');
  });
  it('cae a "Audio" si no hay título ni filename', () => {
    expect(sanitizeTitle('', '')).toBe('Audio');
  });
  it('recorta a 120 caracteres', () => {
    const long = 'x'.repeat(200);
    expect(sanitizeTitle(long, 'a.mp3').length).toBe(120);
  });
});

describe('constantes', () => {
  it('cuota diaria es 1 y los estados activos son los de proceso', () => {
    expect(DAILY_QUOTA).toBe(1);
    expect(ACTIVE_STATUSES).toEqual(['created', 'uploaded', 'processing']);
  });
});
