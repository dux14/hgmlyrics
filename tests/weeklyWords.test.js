// tests/weeklyWords.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/authStore.js', () => ({ getSession: vi.fn(() => null) }));

import { getWeeklyWord } from '../src/lib/weeklyWords.js';
import { _clearCache } from '../src/lib/prefetch.js';

describe('getWeeklyWord (H8: detalle con SWR por id)', () => {
  beforeEach(() => {
    _clearCache();
    global.fetch = vi.fn();
  });

  it('cachea el detalle bajo la key weekly-word-<id> y devuelve el body completo', async () => {
    const body = { id: 'ww1', voiceover_body: 'texto', gospel_body: 'evangelio' };
    global.fetch.mockResolvedValue({ ok: true, json: async () => body });

    const result = await getWeeklyWord('ww1');
    expect(result).toEqual(body);
    expect(global.fetch).toHaveBeenCalledWith('/api/weekly-words/ww1', { headers: {} });

    // Segunda llamada dentro del TTL: sirve de memoria, sin refetch.
    await getWeeklyWord('ww1');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('propaga el error si no hay stale en cache (a diferencia de getWeeklyWords)', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(getWeeklyWord('ww2')).rejects.toThrow('getWeeklyWord failed: 500');
  });
});
