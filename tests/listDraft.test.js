// tests/listDraft.test.js
import { describe, it, expect } from 'vitest';
import {
  filterFriends,
  diffMembers,
  resolveExpiresAt,
  formatExpiry,
  reorder,
} from '../src/lib/listDraft.js';

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

  it('editar sin re-elegir caducidad conserva la fecha existente (no la pisa a +1 día)', () => {
    const current = new Date(Date.now() + 30 * 86400000).toISOString();
    const iso = resolveExpiresAt({ days: null, dateValue: '', current });
    expect(iso).toBe(current);
  });

  it('sin días, sin fecha y sin current cae al default de 1 día', () => {
    const iso = resolveExpiresAt({ days: null, dateValue: '' });
    const dias = (new Date(iso).getTime() - Date.now()) / 86400000;
    expect(dias).toBeGreaterThan(0.99);
    expect(dias).toBeLessThan(1.01);
  });

  it('respeta la hora exacta cuando dateValue la incluye', () => {
    const future = new Date(Date.now() + 86400000);
    const yyyy = future.getFullYear();
    const mm = String(future.getMonth() + 1).padStart(2, '0');
    const dd = String(future.getDate()).padStart(2, '0');
    const dateValue = `${yyyy}-${mm}-${dd}T15:30`; // datetime-local
    const iso = resolveExpiresAt({ days: null, dateValue });
    const d = new Date(iso);
    expect(d.getHours()).toBe(15);
    expect(d.getMinutes()).toBe(30);
  });

  it('lanza si la fecha+hora ya pasó', () => {
    const past = new Date(Date.now() - 3600000);
    const yyyy = past.getFullYear();
    const mm = String(past.getMonth() + 1).padStart(2, '0');
    const dd = String(past.getDate()).padStart(2, '0');
    const hh = String(past.getHours()).padStart(2, '0');
    const mi = String(past.getMinutes()).padStart(2, '0');
    const dateValue = `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
    expect(() => resolveExpiresAt({ days: null, dateValue })).toThrow('futura');
  });
});

describe('formatExpiry', () => {
  it('"caduca hoy" solo si vence el mismo día calendario', () => {
    const hoy = new Date();
    hoy.setHours(23, 59, 59, 999);
    expect(formatExpiry(hoy.toISOString())).toBe('caduca hoy');
  });

  it('preset de 1 día (~24h) dice "caduca mañana", no "caduca hoy"', () => {
    const iso = resolveExpiresAt({ days: 1, dateValue: '' });
    expect(formatExpiry(iso)).toBe('caduca mañana');
  });

  it('fecha lejana muestra los días restantes', () => {
    const iso = resolveExpiresAt({ days: 7, dateValue: '' });
    expect(formatExpiry(iso)).toBe('caduca en 7d');
  });

  it('fecha pasada muestra "caducada"', () => {
    const past = new Date(Date.now() - 3600000).toISOString();
    expect(formatExpiry(past)).toBe('caducada');
  });

  it('sin valor devuelve cadena vacía', () => {
    expect(formatExpiry(null)).toBe('');
  });
});

describe('reorder', () => {
  it('mueve un elemento de un índice a otro', () => {
    expect(reorder(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });
  it('mueve hacia arriba', () => {
    expect(reorder(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });
  it('no muta el array original', () => {
    const src = ['a', 'b', 'c'];
    reorder(src, 0, 1);
    expect(src).toEqual(['a', 'b', 'c']);
  });
  it('devuelve copia igual si from === to', () => {
    expect(reorder(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});
