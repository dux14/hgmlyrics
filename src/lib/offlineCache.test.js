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

  it('no re-descarga si version no cambio', async () => {
    globalThis.matchMedia = () => ({ matches: false });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ songs: [{ id: 1 }], version: 'v1' }),
    });
    vi.doMock('./fetchWithRetry.js', () => ({ fetchWithRetry: fetchMock }));
    const { ensureSongsCached } = await import('./offlineCache.js');
    await ensureSongsCached();
    await ensureSongsCached();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
