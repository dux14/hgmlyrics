import { describe, it, expect, vi, beforeEach } from 'vitest';

const { showToastMock, invalidateOfflineCacheMock } = vi.hoisted(() => ({
  showToastMock: vi.fn(),
  invalidateOfflineCacheMock: vi.fn(),
}));

vi.mock('../src/lib/toast.js', () => ({ showToast: showToastMock }));
vi.mock('../src/lib/offlineCache.js', () => ({
  invalidateOfflineCache: invalidateOfflineCacheMock,
}));

import { clearAppCache } from '../src/lib/cacheClear.js';

describe('clearAppCache', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    showToastMock.mockClear();
    invalidateOfflineCacheMock.mockClear();
    invalidateOfflineCacheMock.mockResolvedValue(undefined);
  });

  it('borra todas las cache keys y el catálogo offline de IndexedDB', async () => {
    const deleteMock = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('caches', {
      keys: vi.fn().mockResolvedValue(['cache-a', 'cache-b']),
      delete: deleteMock,
    });
    vi.stubGlobal('location', { reload: vi.fn() });

    await clearAppCache();

    expect(deleteMock).toHaveBeenCalledWith('cache-a');
    expect(deleteMock).toHaveBeenCalledWith('cache-b');
    expect(invalidateOfflineCacheMock).toHaveBeenCalledTimes(1);
    expect(showToastMock).toHaveBeenCalledWith('Caché limpiado. Recargando...');
  });

  it('muestra un toast de error si falla el borrado', async () => {
    const reloadMock = vi.fn();
    vi.stubGlobal('caches', {
      keys: vi.fn().mockRejectedValue(new Error('boom')),
      delete: vi.fn(),
    });
    vi.stubGlobal('location', { reload: reloadMock });

    await clearAppCache();

    expect(showToastMock).toHaveBeenCalledWith('Error al limpiar caché', { type: 'error' });
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('si invalidateOfflineCache falla (ej. Safari private mode), igual muestra el toast de éxito y recarga', async () => {
    vi.useFakeTimers();
    const reloadMock = vi.fn();
    invalidateOfflineCacheMock.mockRejectedValue(new Error('idb no disponible'));
    vi.stubGlobal('caches', {
      keys: vi.fn().mockResolvedValue(['cache-a']),
      delete: vi.fn().mockResolvedValue(true),
    });
    vi.stubGlobal('location', { reload: reloadMock });

    await clearAppCache();
    await vi.runAllTimersAsync();

    expect(showToastMock).toHaveBeenCalledWith('Caché limpiado. Recargando...');
    expect(reloadMock).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
