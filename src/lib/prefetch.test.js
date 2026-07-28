// src/lib/prefetch.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// idb-keyval no tiene IndexedDB en jsdom: lo mockeamos como no-op resoluble.
vi.mock('idb-keyval', () => ({
  get: vi.fn(async () => undefined),
  set: vi.fn(async () => {}),
  del: vi.fn(async () => {}),
  keys: vi.fn(async () => []),
}));

import { cached, readCached, warm, invalidate, invalidatePrefix, _clearCache } from './prefetch.js';

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

  it('B7: peticiones concurrentes a la misma key en frío dedupan — el fetcher llama una sola vez', async () => {
    let resolveFetch;
    const fetcher = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    // 3 lecturas "simultáneas" antes de que el fetcher resuelva.
    const p1 = cached('dedup-k', fetcher);
    const p2 = cached('dedup-k', fetcher);
    const p3 = cached('dedup-k', fetcher);

    resolveFetch(['solo-una-vez']);
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(r1).toEqual({ data: ['solo-una-vez'], fromCache: false });
    expect(r2).toEqual(r1);
    expect(r3).toEqual(r1);
  });

  it('B7: tras resolver, una lectura posterior en frio dispara un fetch nuevo (no queda colgado en inFlight)', async () => {
    const fetcher = vi.fn(async () => ['primero']);
    await cached('dedup-k2', fetcher);
    invalidate('dedup-k2'); // fuerza frio de nuevo
    const fetcher2 = vi.fn(async () => ['segundo']);
    const r = await cached('dedup-k2', fetcher2);
    expect(fetcher2).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ data: ['segundo'], fromCache: false });
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

describe('invalidatePrefix', () => {
  it('borra todas las keys de memoria que empiezan con el prefijo, sin tocar otras', async () => {
    await cached('profile:ana', async () => ['ana'], { ttl: 10_000 });
    await cached('profile:me', async () => ['me'], { ttl: 10_000 });
    await cached('social:friends', async () => ['friends'], { ttl: 10_000 });
    invalidatePrefix('profile:');
    expect(readCached('profile:ana')).toBeUndefined();
    expect(readCached('profile:me')).toBeUndefined();
    expect(readCached('social:friends')).toEqual(['friends']);
  });
});
