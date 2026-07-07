import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./authStore.js', () => ({
  getSession: vi.fn(() => ({ access_token: 'tok-1' })),
}));

import {
  fetchSectionAudio,
  createSectionAudio,
  uploadSectionAudioFile,
  deleteSectionAudio,
} from './sectionAudioApi.js';

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

describe('createSectionAudio', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('POST con auth headers y body, devuelve uploadUrl/key/id en éxito', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ uploadUrl: 'https://put/x', key: 'song-1/section-0.mp3', id: 'a1' }),
    });
    global.fetch = fetchMock;

    const meta = { sectionIndex: 0, voiceScope: null, label: 'Ensayo', durationSec: 12.5 };
    const result = await createSectionAudio('song-1', meta);

    expect(result).toEqual({ uploadUrl: 'https://put/x', key: 'song-1/section-0.mp3', id: 'a1' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/songs/song-1/section-audio');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer tok-1');
    expect(JSON.parse(opts.body)).toEqual(meta);
  });

  it('respuesta no-ok lanza con el mensaje del backend', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'sectionIndex inválido' }),
    });
    await expect(createSectionAudio('song-1', { sectionIndex: -1 })).rejects.toThrow(
      'sectionIndex inválido',
    );
  });
});

describe('uploadSectionAudioFile', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('hace PUT del archivo con su Content-Type', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock;
    const file = new File(['data'], 'a.mp3', { type: 'audio/mpeg' });

    await uploadSectionAudioFile('https://put/x', file);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://put/x');
    expect(opts.method).toBe('PUT');
    expect(opts.headers['Content-Type']).toBe('audio/mpeg');
    expect(opts.body).toBe(file);
  });

  it('respuesta no-ok lanza error de subida', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
    const file = new File(['data'], 'a.mp3', { type: 'audio/mpeg' });
    await expect(uploadSectionAudioFile('https://put/x', file)).rejects.toThrow(/subida/i);
  });
});

describe('deleteSectionAudio', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('DELETE con auth headers y id en el body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) });
    global.fetch = fetchMock;

    await deleteSectionAudio('song-1', 'a1');

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/songs/song-1/section-audio');
    expect(opts.method).toBe('DELETE');
    expect(opts.headers.Authorization).toBe('Bearer tok-1');
    expect(JSON.parse(opts.body)).toEqual({ id: 'a1' });
  });

  it('respuesta no-ok lanza con el mensaje del backend', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Audio no encontrado' }),
    });
    await expect(deleteSectionAudio('song-1', 'missing')).rejects.toThrow('Audio no encontrado');
  });
});
