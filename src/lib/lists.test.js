// src/lib/lists.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./supabase.js', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: null } })) } },
}));
vi.mock('idb-keyval', () => ({
  get: vi.fn(async () => undefined),
  set: vi.fn(async () => {}),
  del: vi.fn(async () => {}),
}));

import { getList, setListItems, updateList } from './lists.js';
import { _clearCache } from './prefetch.js';

function mockFetch(payload) {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => payload }));
}

beforeEach(() => {
  _clearCache();
  vi.clearAllMocks();
});

describe('getList — cache-aware', () => {
  it('memoiza: la segunda llamada no vuelve a hacer fetch', async () => {
    global.fetch = mockFetch({ id: 'a', name: 'L1' });
    const first = await getList('a');
    const second = await getList('a');
    expect(first).toEqual({ id: 'a', name: 'L1' });
    expect(second).toEqual({ id: 'a', name: 'L1' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('setListItems invalida: la proxima getList vuelve a hacer fetch (datos frescos)', async () => {
    global.fetch = mockFetch({ id: 'a', name: 'L1' });
    await getList('a');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    global.fetch = mockFetch({ ok: true }); // respuesta del PUT
    await setListItems('a', []);

    global.fetch = mockFetch({ id: 'a', name: 'L2' });
    const after = await getList('a');
    expect(after).toEqual({ id: 'a', name: 'L2' });
    expect(global.fetch).toHaveBeenCalledTimes(1); // refetch real, no cache viejo
  });

  it('updateList invalida el cache del detalle', async () => {
    global.fetch = mockFetch({ id: 'b', name: 'X' });
    await getList('b');

    global.fetch = mockFetch({ ok: true });
    await updateList('b', { name: 'Y' });

    global.fetch = mockFetch({ id: 'b', name: 'Y' });
    const after = await getList('b');
    expect(after).toEqual({ id: 'b', name: 'Y' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
