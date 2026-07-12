import { describe, it, expect, vi, beforeEach } from 'vitest';

const idbStore = new Map();
vi.mock('idb-keyval', () => ({
  get: vi.fn((k) => Promise.resolve(idbStore.get(k) ?? null)),
  set: vi.fn((k, v) => {
    idbStore.set(k, v);
    return Promise.resolve();
  }),
}));
const mockFrom = vi.fn();
vi.mock('../src/lib/supabase.js', () => ({ supabase: { from: mockFrom } }));
vi.mock('../src/lib/authStore.js', () => ({
  getSession: () => ({ user: { id: 'u1' }, access_token: 't' }),
  subscribe: () => () => {},
}));
vi.mock('../src/lib/toast.js', () => ({ showToast: vi.fn() }));

describe('favorites offline', () => {
  beforeEach(() => {
    idbStore.clear();
    vi.resetModules();
    mockFrom.mockReset();
  });

  it('restaura ids desde IndexedDB cuando la query a Supabase falla', async () => {
    idbStore.set('hkn-favorites', ['s1', 's2']);
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => Promise.resolve({ data: null, error: new Error('offline') }) }),
    });
    const { initFavorites, isFavorite } = await import('../src/lib/favorites.js');
    await initFavorites();
    expect(isFavorite('s1')).toBe(true);
    expect(isFavorite('s2')).toBe(true);
  });

  it('persiste ids en IndexedDB tras carga exitosa', async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => Promise.resolve({ data: [{ song_id: 's9' }], error: null }) }),
    });
    const { initFavorites } = await import('../src/lib/favorites.js');
    await initFavorites();
    expect(idbStore.get('hkn-favorites')).toEqual(['s9']);
  });
});
