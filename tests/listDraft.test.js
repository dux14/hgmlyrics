// tests/listDraft.test.js
import { describe, it, expect } from 'vitest';
import { filterFriends, diffMembers, resolveExpiresAt } from '../src/lib/listDraft.js';

const friends = [
  { id: 'u1', username: 'andres', displayName: 'Andrés Gómez' },
  { id: 'u2', username: 'maria', displayName: 'María Pérez' },
  { id: 'u3', username: 'juan', displayName: 'Juan' },
];

describe('filterFriends', () => {
  it('filtra acento-insensible por displayName y username', () => {
    const r = filterFriends(friends, 'andre', new Set());
    expect(r.map((f) => f.id)).toEqual(['u1']);
    const r2 = filterFriends(friends, 'maria', new Set());
    expect(r2.map((f) => f.id)).toEqual(['u2']);
  });

  it('excluye ids ya invitados', () => {
    const r = filterFriends(friends, '', new Set(['u1']));
    expect(r.map((f) => f.id)).toEqual(['u2', 'u3']);
  });

  it('query vacía devuelve todos los no excluidos', () => {
    expect(filterFriends(friends, '   ', new Set()).length).toBe(3);
  });
});

describe('diffMembers', () => {
  it('calcula invitaciones nuevas y bajas por id de usuario', () => {
    const original = [
      { user_id: 'u1', username: 'andres' },
      { user_id: 'u2', username: 'maria' },
    ];
    const current = [
      { id: 'u2', username: 'maria' },
      { id: 'u3', username: 'juan' },
    ];
    const { toInvite, toRemove } = diffMembers(original, current);
    expect(toInvite).toEqual(['juan']);
    expect(toRemove).toEqual(['u1']);
  });
});

describe('resolveExpiresAt', () => {
  it('preset de días devuelve ISO futuro', () => {
    const iso = resolveExpiresAt({ days: 7, dateValue: '' });
    expect(new Date(iso).getTime()).toBeGreaterThan(Date.now());
  });

  it('fecha pasada lanza error', () => {
    expect(() => resolveExpiresAt({ days: null, dateValue: '2000-01-01' })).toThrow(
      'La fecha debe ser futura.',
    );
  });

  it('fecha futura exacta gana al preset', () => {
    const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const iso = resolveExpiresAt({ days: 1, dateValue: future });
    expect(iso.slice(0, 10)).toBe(future);
  });
});
