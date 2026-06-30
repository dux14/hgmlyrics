import { describe, it, expect, beforeEach, vi } from 'vitest';

// Moquear dependencias externas para que el módulo cargue sin Supabase ni auth.
vi.mock('./supabase.js', () => ({
  supabase: { from: vi.fn() },
}));
vi.mock('./authStore.js', () => ({
  getSession: () => null,
  subscribe: () => () => {},
}));

import { getFavoriteIds, _setFavoriteIds } from './favorites.js';

describe('getFavoriteIds', () => {
  beforeEach(() => {
    _setFavoriteIds([]);
  });

  it('devuelve array vacío cuando no hay favoritos', () => {
    expect(getFavoriteIds()).toEqual([]);
  });

  it('devuelve los IDs presentes en el estado', () => {
    _setFavoriteIds(['id-1', 'id-2', 'id-3']);
    const result = getFavoriteIds();
    expect(result).toHaveLength(3);
    expect(result).toEqual(expect.arrayContaining(['id-1', 'id-2', 'id-3']));
  });

  it('devuelve una copia: mutar el resultado no altera el estado interno', () => {
    _setFavoriteIds(['id-1']);
    const result = getFavoriteIds();
    result.push('id-extra');
    expect(getFavoriteIds()).toHaveLength(1);
  });

  it('refleja actualizaciones al estado al volver a llamar', () => {
    _setFavoriteIds(['id-1']);
    expect(getFavoriteIds()).toEqual(['id-1']);
    _setFavoriteIds(['id-2', 'id-3']);
    expect(getFavoriteIds()).toHaveLength(2);
    expect(getFavoriteIds()).toContain('id-2');
  });
});
