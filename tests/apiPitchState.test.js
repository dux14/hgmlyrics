import { describe, it, expect } from 'vitest';
import {
  canTransition, expiresAt, validateUploadMeta, sanitizeTitle,
  DAILY_QUOTA, MAX_FILE_BYTES,
} from '../api/pitch/_lib/state.js';

describe('pitch state machine', () => {
  it('transiciones válidas hacia adelante', () => {
    expect(canTransition('awaiting_approval', 'running')).toBe(true);
    expect(canTransition('running', 'succeeded')).toBe(true);
    expect(canTransition('running', 'partial')).toBe(true);
    expect(canTransition('succeeded', 'running')).toBe(false);
    expect(canTransition('cancelled', 'running')).toBe(false);
  });
  it('expiresAt suma 48h', () => {
    const from = new Date('2026-07-05T00:00:00Z');
    expect(expiresAt(from).toISOString()).toBe('2026-07-07T00:00:00.000Z');
  });
  it('valida MIME/tamaño', () => {
    expect(() => validateUploadMeta({ filename: 'a.mp3', size: 1, mime: 'audio/mpeg' })).not.toThrow();
    expect(() => validateUploadMeta({ filename: 'a.txt', size: 1, mime: 'text/plain' })).toThrow();
    expect(() => validateUploadMeta({ filename: 'a.mp3', size: MAX_FILE_BYTES + 1, mime: 'audio/mpeg' })).toThrow();
  });
  it('validateUploadMeta rechaza size 0, negativo y NaN', () => {
    for (const bad of [0, -1, NaN]) {
      expect(() => validateUploadMeta({ filename: 'a.mp3', size: bad, mime: 'audio/mpeg' })).toThrow(/tama/i);
    }
  });
  it('sanitizeTitle cae al nombre de archivo', () => {
    expect(sanitizeTitle('', 'Mi Canción.mp3')).toBe('Mi Canción');
    expect(sanitizeTitle('  Hola  ')).toBe('Hola');
  });
  it('sanitizeTitle trunca a 120 caracteres', () => {
    const long = 'x'.repeat(200);
    expect(sanitizeTitle(long).length).toBe(120);
  });
  it('DAILY_QUOTA definido', () => { expect(DAILY_QUOTA).toBeGreaterThanOrEqual(1); });
});
