import { describe, it, expect, vi } from 'vitest';

vi.mock('idb-keyval', () => ({ get: vi.fn(() => Promise.resolve(null)), set: vi.fn() }));
vi.mock('./authStore.js', () => ({
  getSession: () => null,
  subscribe: () => () => {},
}));
vi.mock('./offlineCache.js', () => ({
  getOfflineSong: vi.fn((id) =>
    Promise.resolve(id === 's1' ? { id: 's1', title: 'Offline' } : null),
  ),
}));

describe('fetchSongDetail fallback offline', () => {
  it('usa IndexedDB cuando la API responde no-ok (500/proxy cautivo)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 502 });
    const { fetchSongDetail } = await import('./store.js');
    const song = await fetchSongDetail('s1');
    expect(song).toEqual({ id: 's1', title: 'Offline' });
  });

  it('usa IndexedDB cuando el fetch lanza (offline real)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const { fetchSongDetail } = await import('./store.js');
    const song = await fetchSongDetail('s1');
    expect(song).toEqual({ id: 's1', title: 'Offline' });
  });

  it('un 404 es autoritativo: retorna null sin usar el cache aunque exista', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const { fetchSongDetail } = await import('./store.js');
    const song = await fetchSongDetail('s1');
    expect(song).toBeNull();
  });

  it('cache-miss: fetch lanza y no hay copia offline, retorna null', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const { fetchSongDetail } = await import('./store.js');
    const song = await fetchSongDetail('desconocida');
    expect(song).toBeNull();
  });
});
