import { describe, it, expect, vi, beforeEach } from 'vitest';

// Estado mutable compartido con las factorías hoisted de vi.mock (mismo
// patrón que recentVisits.test.js).
const h = vi.hoisted(() => ({
  idbStore: new Map(),
  session: null,
  pending: false,
  authListeners: new Set(),
  selectResult: { data: [], error: null },
  insertResult: { error: null },
  deleteResult: { error: null },
}));

vi.mock('idb-keyval', () => ({
  get: vi.fn((k) => Promise.resolve(h.idbStore.get(k) ?? null)),
  set: vi.fn((k, v) => {
    h.idbStore.set(k, v);
    return Promise.resolve();
  }),
}));

vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => Promise.resolve(h.selectResult) }),
      insert: () => Promise.resolve(h.insertResult),
      delete: () => ({ eq: () => ({ eq: () => Promise.resolve(h.deleteResult) }) }),
    }),
  },
}));

vi.mock('../src/lib/authStore.js', () => ({
  getSession: () => h.session,
  isPendingSession: () => h.pending,
  subscribe: (fn) => {
    h.authListeners.add(fn);
    return () => h.authListeners.delete(fn);
  },
}));

const showToastMock = vi.fn();
vi.mock('../src/lib/toast.js', () => ({ showToast: (...args) => showToastMock(...args) }));

function emitAuth(session) {
  h.session = session;
  return Promise.all([...h.authListeners].map((fn) => fn({ session })));
}

beforeEach(() => {
  h.idbStore.clear();
  h.session = null;
  h.pending = false;
  h.authListeners.clear();
  h.selectResult = { data: [], error: null };
  h.insertResult = { error: null };
  h.deleteResult = { error: null };
  showToastMock.mockClear();
  vi.resetModules();
});

describe('favorites offline', () => {
  it('restaura ids desde IndexedDB cuando la query a Supabase falla', async () => {
    h.idbStore.set('hkn-favorites', ['s1', 's2']);
    h.session = { user: { id: 'u1' } };
    h.selectResult = { data: null, error: new Error('offline') };
    const { initFavorites, isFavorite } = await import('../src/lib/favorites.js');
    await initFavorites();
    expect(isFavorite('s1')).toBe(true);
    expect(isFavorite('s2')).toBe(true);
  });

  it('persiste ids en IndexedDB tras carga exitosa', async () => {
    h.session = { user: { id: 'u1' } };
    h.selectResult = { data: [{ song_id: 's9' }], error: null };
    const { initFavorites } = await import('../src/lib/favorites.js');
    await initFavorites();
    expect(h.idbStore.get('hkn-favorites')).toEqual(['s9']);
  });

  it('(a) un toggle exitoso persiste el snapshot en IndexedDB', async () => {
    h.session = { user: { id: 'u1' } };
    const { initFavorites, toggleFavorite } = await import('../src/lib/favorites.js');
    await initFavorites();
    await toggleFavorite('s1');
    expect(h.idbStore.get('hkn-favorites')).toEqual(['s1']);
  });

  it('(b) un toggle fallido revierte y avisa con toast de error', async () => {
    h.session = { user: { id: 'u1' } };
    h.insertResult = { error: new Error('offline') };
    const { initFavorites, toggleFavorite, isFavorite } = await import('../src/lib/favorites.js');
    await initFavorites();
    const result = await toggleFavorite('s1');
    expect(result).toBe(false);
    expect(isFavorite('s1')).toBe(false);
    expect(showToastMock).toHaveBeenCalledWith(
      'No se pudo guardar el favorito. Revisa tu conexión.',
      { type: 'error' },
    );
  });

  it('(c) un logout real (sin pendingSession) limpia el snapshot en IndexedDB', async () => {
    h.session = { user: { id: 'u1' } };
    h.selectResult = { data: [{ song_id: 's1' }], error: null };
    const { initFavorites } = await import('../src/lib/favorites.js');
    await initFavorites();
    expect(h.idbStore.get('hkn-favorites')).toEqual(['s1']);

    h.pending = false;
    await emitAuth(null);
    expect(h.idbStore.get('hkn-favorites')).toBeNull();
  });

  it('(d) boot offline con pendingSession restaura favoritos desde IndexedDB (Critical #1)', async () => {
    h.idbStore.set('hkn-favorites', ['s5']);
    h.session = null;
    h.pending = true;
    const { initFavorites, isFavorite } = await import('../src/lib/favorites.js');
    await initFavorites();
    expect(isFavorite('s5')).toBe(true);
  });
});
