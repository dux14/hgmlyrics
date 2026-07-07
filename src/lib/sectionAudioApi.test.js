import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./authStore.js', () => ({
  getSession: vi.fn(() => null),
}));

import { fetchSectionAudio } from './sectionAudioApi.js';

describe('fetchSectionAudio', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('devuelve items en respuesta ok', async () => {
    const items = [{ id: '1', sectionIndex: 0, voiceScope: null, url: 'https://x/1.mp3' }];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items }),
    });
    const result = await fetchSectionAudio('song-1');
    expect(result).toEqual(items);
  });

  it('respuesta no-ok (401/404/500) → []', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    expect(await fetchSectionAudio('song-1')).toEqual([]);
  });

  it('fetch que lanza (red caída) → []', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network'));
    expect(await fetchSectionAudio('song-1')).toEqual([]);
  });

  it('body sin items válidos → []', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    expect(await fetchSectionAudio('song-1')).toEqual([]);
  });
});
