// src/lib/weeklyWords.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./authStore.js', () => ({
  getSession: vi.fn(() => ({ access_token: 'token123' })),
}));

import { _clearCache } from './prefetch.js';
import { getWeeklyWord, getWeeklyWords, invalidateWeeklyWords } from './weeklyWords.js';

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

  it('un 500 transitorio sin cache previa no se cachea: la siguiente llamada reintenta la red', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const first = await getWeeklyWords();
    expect(first).toEqual([]); // degrada, pero sin cachear el error
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ weeklyWords: [{ id: 'w1' }] }),
    });
    const second = await getWeeklyWords();
    expect(second).toEqual([{ id: 'w1' }]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('getWeeklyWord (H8: detalle con SWR por id)', () => {
  it('cachea el detalle bajo la key weekly-word-<id> y devuelve el body completo', async () => {
    const body = { id: 'ww1', voiceover_body: 'texto', gospel_body: 'evangelio' };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => body });

    const result = await getWeeklyWord('ww1');
    expect(result).toEqual(body);
    expect(global.fetch).toHaveBeenCalledWith('/api/weekly-words/ww1', {
      headers: { Authorization: 'Bearer token123' },
    });

    // Segunda llamada dentro del TTL: sirve de memoria, sin refetch.
    await getWeeklyWord('ww1');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('propaga el error si no hay stale en cache (a diferencia de getWeeklyWords)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(getWeeklyWord('ww2')).rejects.toThrow('getWeeklyWord failed: 500');
  });

  it('invalidateWeeklyWords() limpia tambien las keys por id (fuga de contenido entre viewers, Critical)', async () => {
    const draft = { id: 'ww3', voiceover_body: 'draft del admin' };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => draft });

    await getWeeklyWord('ww3'); // el admin visita el draft: queda en memoria+idb
    invalidateWeeklyWords(); // logout / guardar / publicar / borrar

    const published = { id: 'ww3', voiceover_body: 'version publicada' };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => published });

    const result = await getWeeklyWord('ww3');
    expect(result).toEqual(published); // sin la invalidacion por prefijo, seguiria sirviendo el draft
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
