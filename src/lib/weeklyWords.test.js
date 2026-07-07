// src/lib/weeklyWords.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./authStore.js', () => ({
  getSession: vi.fn(() => ({ access_token: 'token123' })),
}));

import { _clearCache } from './prefetch.js';
import { getWeeklyWords, invalidateWeeklyWords } from './weeklyWords.js';

beforeEach(() => {
  _clearCache();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ weeklyWords: [{ id: 'w1' }] }),
  });
});

describe('getWeeklyWords', () => {
  it('dos llamadas seguidas hacen UNA sola llamada de red y devuelven el mismo resultado', async () => {
    const first = await getWeeklyWords();
    const second = await getWeeklyWords();
    expect(first).toEqual([{ id: 'w1' }]);
    expect(second).toEqual([{ id: 'w1' }]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('tras invalidateWeeklyWords() vuelve a la red', async () => {
    await getWeeklyWords();
    invalidateWeeklyWords();
    await getWeeklyWords();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
