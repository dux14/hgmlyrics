import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/lib/supabase.js', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

import { setActiveContext, getActiveContext, getAdjacentInList } from '../src/lib/lists.js';

describe('contexto de reproducción de lista', () => {
  beforeEach(() => setActiveContext(null));

  it('guarda y lee el contexto activo', () => {
    setActiveContext({ listId: 'l1', name: 'Mi lista', orderedSongIds: ['a', 'b', 'c'] });
    expect(getActiveContext().listId).toBe('l1');
  });

  it('navega circular dentro de la lista', () => {
    setActiveContext({ listId: 'l1', name: 'L', orderedSongIds: ['a', 'b', 'c'] });
    const at = getAdjacentInList('l1', 'b');
    expect(at.prev.id).toBe('a');
    expect(at.next.id).toBe('c');
    expect(at.currentIndex).toBe(1);
    expect(at.total).toBe(3);
    const wrap = getAdjacentInList('l1', 'c');
    expect(wrap.next.id).toBe('a'); // circular
  });

  it('devuelve null si el contexto no coincide', () => {
    expect(getAdjacentInList('otra', 'b')).toBeNull();
  });
});
