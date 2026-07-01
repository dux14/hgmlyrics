// src/lib/prefetch.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// idb-keyval no tiene IndexedDB en jsdom: lo mockeamos como no-op resoluble.
vi.mock('idb-keyval', () => ({
  get: vi.fn(async () => undefined),
  set: vi.fn(async () => {}),
  del: vi.fn(async () => {}),
}));

import { cached, readCached, warm, invalidate, _clearCache } from './prefetch.js';

beforeEach(() => {
  _clearCache();
  vi.clearAllMocks();
});

describe('cached', () => {
  it('llama al fetcher en frío y cachea en memoria', async () => {
    const fetcher = vi.fn(async () => ['x']);
    const r = await cached('k', fetcher);
    expect(r).toEqual({ data: ['x'], fromCache: false });
    expect(readCached('k')).toEqual(['x']);
  });

  it('devuelve memoria fresca sin volver a llamar al fetcher', async () => {
    const fetcher = vi.fn(async () => ['x']);
    await cached('k', fetcher);
    const r = await cached('k', fetcher, { ttl: 10_000 });
    expect(r.fromCache).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('propaga el error si falla y no hay respaldo', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('red caída');
    });
    await expect(cached('k', fetcher)).rejects.toThrow('red caída');
  });

  it('cae al respaldo en memoria si el refetch falla', async () => {
    await cached('k', async () => ['viejo']);
    const r = await cached('k', async () => {
      throw new Error('red');
    }, { ttl: 0 }); // ttl 0 fuerza revalidación
    expect(r).toEqual({ data: ['viejo'], fromCache: true });
  });
});

describe('warm', () => {
  it('dispara el fetcher si no hay cache fresca', async () => {
    const fetcher = vi.fn(async () => ['y']);
    warm('w', fetcher);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('no dispara si ya está fresco', async () => {
    const fetcher = vi.fn(async () => ['y']);
    await cached('w', fetcher, { ttl: 10_000 });
    warm('w', fetcher, { ttl: 10_000 });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('invalidate', () => {
  it('borra la memoria y fuerza un refetch en la próxima lectura', async () => {
    await cached('k', async () => ['v1'], { ttl: 10_000 });
    expect(readCached('k')).toEqual(['v1']);
    invalidate('k');
    expect(readCached('k')).toBeUndefined();
    const r = await cached('k', async () => ['v2'], { ttl: 10_000 });
    expect(r).toEqual({ data: ['v2'], fromCache: false });
  });
});
