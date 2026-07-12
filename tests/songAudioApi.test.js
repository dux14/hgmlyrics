/**
 * songAudioApi.test.js — TDD para el cliente de audio completo + timings
 * (GET /api/songs/:id/audio). Mismo patrón que src/lib/sectionAudioApi.test.js:
 * mock de authStore + fetch, sin throws (la vista degrada a timer).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/authStore.js', () => ({
  getSession: vi.fn(() => ({ access_token: 'tok-1' })),
}));

import {
  getSongAudio,
  createSongAudioUpload,
  confirmSongAudio,
  deleteSongAudio,
  uploadSongAudioFile,
  patchSongAudio,
  patchLineTiming,
} from '../src/lib/songAudioApi.js';

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

describe('createSongAudioUpload', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('postea sin confirm y devuelve {uploadUrl,key}', async () => {
    const body = { uploadUrl: 'https://x/put', key: 'song-1/full.mp3' };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });
    global.fetch = fetchMock;

    const result = await createSongAudioUpload('song-1');

    expect(result).toEqual(body);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/songs/song-1/audio');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer tok-1');
  });

  it('respuesta no-ok lanza con el mensaje del backend', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'x' }) });

    await expect(createSongAudioUpload('song-1')).rejects.toThrow('x');
  });
});

describe('confirmSongAudio', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('postea body {confirm:true, durationSec}', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) });
    global.fetch = fetchMock;

    await confirmSongAudio('song-1', 222);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/songs/song-1/audio');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ confirm: true, durationSec: 222 });
  });

  it('respuesta no-ok lanza con el mensaje del backend', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'x' }) });

    await expect(confirmSongAudio('song-1', 222)).rejects.toThrow('x');
  });
});

describe('deleteSongAudio', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('hace DELETE', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) });
    global.fetch = fetchMock;

    await deleteSongAudio('song-1');

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/songs/song-1/audio');
    expect(opts.method).toBe('DELETE');
  });

  it('respuesta no-ok lanza con el mensaje del backend', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'x' }) });

    await expect(deleteSongAudio('song-1')).rejects.toThrow('x');
  });
});

describe('patchSongAudio', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('hace PATCH con auth headers y manda solo las claves definidas', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) });
    global.fetch = fetchMock;

    await patchSongAudio('song-1', { bpmManual: 120, timeSignature: undefined });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/songs/song-1/audio');
    expect(opts.method).toBe('PATCH');
    expect(opts.headers.Authorization).toBe('Bearer tok-1');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(opts.body)).toEqual({ bpmManual: 120 });
  });

  it('null se manda explícito (limpia el override)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) });
    global.fetch = fetchMock;

    await patchSongAudio('song-1', { bpmManual: null });

    const [, opts] = fetchMock.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ bpmManual: null });
  });

  it('respuesta no-ok lanza con el mensaje del backend', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'bpm invalido' }) });

    await expect(patchSongAudio('song-1', { bpmManual: -1 })).rejects.toThrow('bpm invalido');
  });
});

describe('patchLineTiming', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('hace PATCH con body {lineTiming:{i,startMs}}', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) });
    global.fetch = fetchMock;

    await patchLineTiming('song-1', 3, 51200);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/songs/song-1/audio');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ lineTiming: { i: 3, startMs: 51200 } });
  });
});

describe('uploadSongAudioFile', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('hace PUT del file al uploadUrl con Content-Type audio/mpeg', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock;
    const file = new Blob(['x']);

    await uploadSongAudioFile('https://x/put', file);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://x/put');
    expect(opts.method).toBe('PUT');
    expect(opts.headers['Content-Type']).toBe('audio/mpeg');
    expect(opts.body).toBe(file);
  });

  it('respuesta no-ok lanza', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
    await expect(uploadSongAudioFile('https://x/put', new Blob(['x']))).rejects.toThrow();
  });
});
