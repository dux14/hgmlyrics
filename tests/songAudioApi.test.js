/**
 * songAudioApi.test.js — TDD para el cliente de audio completo + timings
 * (GET /api/songs/:id/audio). Mismo patrón que src/lib/sectionAudioApi.test.js:
 * mock de authStore + fetch, sin throws (la vista degrada a timer).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/authStore.js', () => ({
  getSession: vi.fn(() => ({ access_token: 'tok-1' })),
}));

import { getSongAudio } from '../src/lib/songAudioApi.js';

describe('getSongAudio', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('devuelve audio+timings en respuesta ok', async () => {
    const body = {
      audio: { url: 'https://x/full.mp3', durationSec: 187.4 },
      timings: { status: 'ready', lines: [{ start: 0, end: 1.2, text: 'hola' }] },
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });
    global.fetch = fetchMock;

    const result = await getSongAudio('song-1');

    expect(result).toEqual(body);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/songs/song-1/audio');
    expect(opts.headers.Authorization).toBe('Bearer tok-1');
  });

  it('respuesta ok sin audio ni timings → {audio:null, timings:null}', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ audio: null, timings: null }) });

    expect(await getSongAudio('song-1')).toEqual({ audio: null, timings: null });
  });

  it('respuesta no-ok (401/404/500) → null', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    expect(await getSongAudio('song-1')).toBeNull();
  });

  it('fetch que lanza (red caída) → null', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network'));
    expect(await getSongAudio('song-1')).toBeNull();
  });

  it('json invalido en respuesta ok → null', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('bad json')) });
    expect(await getSongAudio('song-1')).toBeNull();
  });
});
