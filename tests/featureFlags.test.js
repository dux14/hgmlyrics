import { describe, it, expect } from 'vitest';
import { resolveEnabledFlags, FLAG_KEYS } from '../src/lib/featureFlags.js';

describe('FLAG_KEYS', () => {
  it('expone las keys de la iniciativa', () => {
    expect(FLAG_KEYS).toContain('voz_tono');
    expect(FLAG_KEYS).toContain('afinador_shortcut');
  });
});

describe('resolveEnabledFlags', () => {
  it('incluye flags globales', () => {
    const catalog = [{ key: 'voz_tono', enabledGlobal: true }];
    expect(resolveEnabledFlags(catalog, [], { email: 'a@b.com' })).toEqual(['voz_tono']);
  });

  it('incluye flag asignado por email (case-insensitive)', () => {
    const catalog = [{ key: 'voz_tono', enabledGlobal: false }];
    const assignments = [{ flagKey: 'voz_tono', email: 'A@B.com', username: null }];
    expect(resolveEnabledFlags(catalog, assignments, { email: 'a@b.com' })).toEqual(['voz_tono']);
  });

  it('incluye flag asignado por username (case-insensitive)', () => {
    const catalog = [{ key: 'voz_tono', enabledGlobal: false }];
    const assignments = [{ flagKey: 'voz_tono', email: null, username: 'Samu' }];
    expect(resolveEnabledFlags(catalog, assignments, { username: 'samu' })).toEqual(['voz_tono']);
  });

  it('no incluye flag no asignado ni global', () => {
    const catalog = [{ key: 'voz_tono', enabledGlobal: false }];
    expect(resolveEnabledFlags(catalog, [], { email: 'x@y.com' })).toEqual([]);
  });

  it('no duplica si está global y asignado', () => {
    const catalog = [{ key: 'voz_tono', enabledGlobal: true }];
    const assignments = [{ flagKey: 'voz_tono', email: 'a@b.com', username: null }];
    const out = resolveEnabledFlags(catalog, assignments, { email: 'a@b.com' });
    expect(out).toEqual(['voz_tono']);
  });

  it('tolera identidad vacía', () => {
    const catalog = [{ key: 'voz_tono', enabledGlobal: false }];
    expect(resolveEnabledFlags(catalog, [], {})).toEqual([]);
  });
});
