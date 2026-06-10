import { describe, it, expect } from 'vitest';
import {
  canTransition,
  DAILY_QUOTA,
  ACTIVE_STATUSES,
  expiresAt,
  validateUploadMeta,
} from '../api/_lib/stems.js';

describe('canTransition', () => {
  it('permite el camino feliz completo', () => {
    expect(canTransition('created', 'uploaded')).toBe(true);
    expect(canTransition('uploaded', 'separating_stems')).toBe(true);
    expect(canTransition('separating_stems', 'separating_voices')).toBe(true);
    expect(canTransition('separating_voices', 'done')).toBe(true);
    expect(canTransition('done', 'expired')).toBe(true);
  });

  it('permite failed desde estados en proceso, no desde done', () => {
    expect(canTransition('separating_stems', 'failed')).toBe(true);
    expect(canTransition('separating_voices', 'failed')).toBe(true);
    expect(canTransition('done', 'failed')).toBe(false);
  });

  it('rechaza retrocesos y estados desconocidos', () => {
    expect(canTransition('done', 'separating_stems')).toBe(false);
    expect(canTransition('expired', 'done')).toBe(false);
    expect(canTransition('nope', 'done')).toBe(false);
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

describe('constantes', () => {
  it('cuota diaria es 3 y los estados activos son los de proceso', () => {
    expect(DAILY_QUOTA).toBe(3);
    expect(ACTIVE_STATUSES).toEqual([
      'created',
      'uploaded',
      'separating_stems',
      'separating_voices',
    ]);
  });
});
