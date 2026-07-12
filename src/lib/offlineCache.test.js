import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('idb-keyval', () => {
  const store = new Map();
  return {
    get: vi.fn((k) => Promise.resolve(store.get(k) ?? null)),
    set: vi.fn((k, v) => {
      store.set(k, v);
      return Promise.resolve();
    }),
    __store: store,
  };
});

describe('offlineCache prefetch gating', () => {
  beforeEach(async () => {
    // The hoisted vi.mock factory runs once; the store Map is a singleton.
    // Clear it between tests so cached versions don't bleed across test cases.
    const { __store } = await import('idb-keyval');
    __store.clear();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('prefetch corre aunque NO sea PWA (display-mode browser)', async () => {
    globalThis.matchMedia = () => ({ matches: false });
    globalThis.navigator.standalone = false;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ songs: [{ id: 1 }], version: 'v1' }),
    });
    vi.doMock('./fetchWithRetry.js', () => ({ fetchWithRetry: fetchMock }));
    const { ensureSongsCached } = await import('./offlineCache.js');
    await ensureSongsCached();
    expect(fetchMock).toHaveBeenCalledWith('/api/songs/all');
  });

  it('siempre revalida contra el servidor pero no re-escribe si version no cambio', async () => {
    globalThis.matchMedia = () => ({ matches: false });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ songs: [{ id: 1 }], version: 'v1' }),
    });
    vi.doMock('./fetchWithRetry.js', () => ({ fetchWithRetry: fetchMock }));
    const idb = await import('idb-keyval');
    const { ensureSongsCached } = await import('./offlineCache.js');
    await ensureSongsCached();
    const writesAfterFirst = idb.set.mock.calls.length;
    await ensureSongsCached();
    expect(fetchMock).toHaveBeenCalledTimes(2); // revalida SIEMPRE
    expect(idb.set.mock.calls.length).toBe(writesAfterFirst); // pero no re-escribe
  });

  it('re-escribe cuando la version del servidor cambia', async () => {
    globalThis.matchMedia = () => ({ matches: false });
    let v = 'v1';
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ songs: [{ id: 1 }], version: v }),
        }),
      );
    vi.doMock('./fetchWithRetry.js', () => ({ fetchWithRetry: fetchMock }));
    const idb = await import('idb-keyval');
    const { ensureSongsCached } = await import('./offlineCache.js');
    await ensureSongsCached();
    v = 'v2';
    await ensureSongsCached();
    expect(await idb.get('hkn-offline-version')).toBe('v2');
  });
});
