/**
 * pipelineApiClient.test.js — cliente src/lib/pipelineApi.js del run del
 * pipeline unificado (Task D1): getPipelineRun/createPipelineRun/
 * confirmPipelineUpload/retryPipelinePhase/cancelPipelineRun/
 * renamePipelineAudio + watchPipelineRun (Realtime broadcast + polling).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/lib/authStore.js', () => ({
  getSession: vi.fn(() => ({ access_token: 'tok' })),
}));

const channelStub = {
  on: vi.fn(function on() {
    return this;
  }),
  subscribe: vi.fn(function subscribe() {
    return this;
  }),
};
const channelSpy = vi.fn(() => channelStub);
const removeChannelSpy = vi.fn();
vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    channel: (...args) => channelSpy(...args),
    removeChannel: (...args) => removeChannelSpy(...args),
  },
}));

import { getSession } from '../src/lib/authStore.js';
import {
  getPipelineRun,
  createPipelineRun,
  confirmPipelineUpload,
  retryPipelinePhase,
  cancelPipelineRun,
  renamePipelineAudio,
  publishLyricsToSongbook,
  watchPipelineRun,
} from '../src/lib/pipelineApi.js';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockReturnValue({ access_token: 'tok' });
  global.fetch = vi.fn();
});

describe('getPipelineRun', () => {
  it('200 devuelve el run', async () => {
    global.fetch.mockResolvedValue(jsonResponse(200, { run: { id: 'r1' } }));
    const result = await getPipelineRun('s1');
    expect(result).toEqual({ run: { id: 'r1' } });
    expect(global.fetch).toHaveBeenCalledWith('/api/songs/s1/pipeline', {
      headers: { Authorization: 'Bearer tok' },
    });
  });

  it('404 devuelve null (sin lanzar)', async () => {
    global.fetch.mockResolvedValue(jsonResponse(404, { error: 'No hay una ejecución activa' }));
    const result = await getPipelineRun('s1');
    expect(result).toBeNull();
  });

  it('500 lanza con status', async () => {
    global.fetch.mockResolvedValue(jsonResponse(500, { error: 'boom' }));
    await expect(getPipelineRun('s1')).rejects.toMatchObject({ status: 500, message: 'boom' });
  });
});

describe('createPipelineRun', () => {
  it('POST con body {filename,size,mime} y header Bearer', async () => {
    global.fetch.mockResolvedValue(jsonResponse(200, { runId: 'r1', uploadUrl: 'https://put' }));
    const result = await createPipelineRun('s1', { fileName: 'a.mp3', size: 10, mime: 'audio/mpeg' });
    expect(result).toEqual({ runId: 'r1', uploadUrl: 'https://put' });
    expect(global.fetch).toHaveBeenCalledWith('/api/songs/s1/pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ filename: 'a.mp3', size: 10, mime: 'audio/mpeg' }),
    });
  });

  it('error lanza', async () => {
    global.fetch.mockResolvedValue(jsonResponse(409, { error: 'ya hay una ejecución activa' }));
    await expect(createPipelineRun('s1', { fileName: 'a.mp3' })).rejects.toThrow();
  });
});

describe('confirmPipelineUpload', () => {
  it('POST a /confirm con durationSec en el body', async () => {
    global.fetch.mockResolvedValue(jsonResponse(200, { success: true }));
    const result = await confirmPipelineUpload('s1', { durationSec: 180 });
    expect(result).toEqual({ success: true });
    expect(global.fetch).toHaveBeenCalledWith('/api/songs/s1/pipeline/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ durationSec: 180 }),
    });
  });
});

describe('retryPipelinePhase', () => {
  it('POST a /retry con body {phase}', async () => {
    global.fetch.mockResolvedValue(jsonResponse(200, { success: true }));
    const result = await retryPipelinePhase('s1', 'stems');
    expect(result).toEqual({ success: true });
    expect(global.fetch).toHaveBeenCalledWith('/api/songs/s1/pipeline/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ phase: 'stems' }),
    });
  });
});

describe('cancelPipelineRun', () => {
  it('DELETE con header Bearer', async () => {
    global.fetch.mockResolvedValue(jsonResponse(200, { success: true }));
    const result = await cancelPipelineRun('s1');
    expect(result).toEqual({ success: true });
    expect(global.fetch).toHaveBeenCalledWith('/api/songs/s1/pipeline', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer tok' },
    });
  });
});

describe('renamePipelineAudio', () => {
  it('PATCH con body {displayName}', async () => {
    global.fetch.mockResolvedValue(jsonResponse(200, { success: true }));
    const result = await renamePipelineAudio('s1', 'Voz principal');
    expect(result).toEqual({ success: true });
    expect(global.fetch).toHaveBeenCalledWith('/api/songs/s1/pipeline', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ displayName: 'Voz principal' }),
    });
  });
});

describe('publishLyricsToSongbook', () => {
  it('PUT con action publishToSongbook y header Bearer', async () => {
    global.fetch.mockResolvedValue(jsonResponse(200, { success: true }));
    const result = await publishLyricsToSongbook('s1');
    expect(result).toEqual({ success: true });
    expect(global.fetch).toHaveBeenCalledWith('/api/songs/s1/pipeline/lyrics', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ action: { type: 'publishToSongbook' } }),
    });
  });

  it('error lanza con el mensaje del backend', async () => {
    global.fetch.mockResolvedValue(
      jsonResponse(404, { error: 'Esta canción no tiene letra de pipeline aprobada' }),
    );
    await expect(publishLyricsToSongbook('s1')).rejects.toMatchObject({
      status: 404,
      message: 'Esta canción no tiene letra de pipeline aprobada',
    });
  });
});

describe('watchPipelineRun', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hace un refresh inicial, se suscribe al canal y arranca el polling', async () => {
    global.fetch.mockResolvedValue(jsonResponse(200, { run: { id: 'r1' } }));
    const onChange = vi.fn();
    watchPipelineRun('s1', onChange);

    await vi.advanceTimersByTimeAsync(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ run: { id: 'r1' } });
    expect(channelSpy).toHaveBeenCalledWith('pipeline:run:s1', {
      config: { broadcast: { self: false } },
    });
    expect(channelStub.subscribe).toHaveBeenCalled();
  });

  it('el polling dispara otro refresh a los 3s', async () => {
    global.fetch.mockResolvedValue(jsonResponse(200, { run: { id: 'r1' } }));
    const onChange = vi.fn();
    watchPipelineRun('s1', onChange);
    await vi.advanceTimersByTimeAsync(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('un evento de broadcast dispara un refresh', async () => {
    global.fetch.mockResolvedValue(jsonResponse(200, { run: { id: 'r1' } }));
    const onChange = vi.fn();
    watchPipelineRun('s1', onChange);
    await vi.advanceTimersByTimeAsync(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const broadcastHandler = channelStub.on.mock.calls.find(
      (call) => call[0] === 'broadcast' && call[1]?.event === 'change',
    )[2];
    broadcastHandler();
    await vi.advanceTimersByTimeAsync(0);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('unsubscribe limpia el intervalo, remueve el canal y es idempotente', async () => {
    global.fetch.mockResolvedValue(jsonResponse(200, { run: { id: 'r1' } }));
    const onChange = vi.fn();
    const unsubscribe = watchPipelineRun('s1', onChange);
    await vi.advanceTimersByTimeAsync(0);

    unsubscribe();
    expect(removeChannelSpy).toHaveBeenCalledWith(channelStub);

    const callsBefore = global.fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(global.fetch).toHaveBeenCalledTimes(callsBefore);

    expect(() => unsubscribe()).not.toThrow();
    expect(removeChannelSpy).toHaveBeenCalledTimes(1);
  });

  it('descarta una respuesta que resuelve despues de unsubscribe (guard stopped)', async () => {
    let resolveFetch;
    global.fetch = vi.fn(
      () =>
        new Promise((r) => {
          resolveFetch = r;
        }),
    );
    const onChange = vi.fn();
    const unsubscribe = watchPipelineRun('s1', onChange);
    await vi.advanceTimersByTimeAsync(0);

    unsubscribe();
    resolveFetch(jsonResponse(200, { run: { id: 'r1' } }));
    await vi.advanceTimersByTimeAsync(0);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('cuando refresh() rechaza, emite onChange con {error} (sentinel del catch)', async () => {
    global.fetch.mockResolvedValue(jsonResponse(500, { error: 'boom' }));
    const onChange = vi.fn();
    watchPipelineRun('s1', onChange);

    await vi.advanceTimersByTimeAsync(0);

    expect(onChange).toHaveBeenCalledWith({
      error: expect.objectContaining({ message: 'boom', status: 500 }),
    });
  });

  it('guard stopped: un rechazo que llega despues de unsubscribe no emite {error}', async () => {
    let rejectFetch;
    global.fetch = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectFetch = reject;
        }),
    );
    const onChange = vi.fn();
    const unsubscribe = watchPipelineRun('s1', onChange);
    await vi.advanceTimersByTimeAsync(0);

    unsubscribe();
    rejectFetch(new Error('boom'));
    await vi.advanceTimersByTimeAsync(0);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('guard reqId: un rechazo de un refresh obsoleto no emite {error}', async () => {
    const pending = [];
    global.fetch = vi.fn(
      () =>
        new Promise((resolve, reject) => {
          pending.push({ resolve, reject });
        }),
    );
    const onChange = vi.fn();
    watchPipelineRun('s1', onChange);
    await vi.advanceTimersByTimeAsync(0); // primer refresh en vuelo (pending[0])

    const broadcastHandler = channelStub.on.mock.calls.find(
      (call) => call[0] === 'broadcast' && call[1]?.event === 'change',
    )[2];
    broadcastHandler(); // dispara un segundo refresh, ahora el mas reciente (pending[1])
    await vi.advanceTimersByTimeAsync(0);

    pending[0].reject(new Error('viejo')); // resuelve el obsoleto DESPUES del mas nuevo
    await vi.advanceTimersByTimeAsync(0);

    expect(onChange).not.toHaveBeenCalled();

    pending[1].resolve(jsonResponse(200, { run: { id: 'r2' } }));
    await vi.advanceTimersByTimeAsync(0);

    expect(onChange).toHaveBeenCalledWith({ run: { id: 'r2' } });
  });

  it('un exito posterior a un error emite {run} normal (sin error)', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }));
    const onChange = vi.fn();
    watchPipelineRun('s1', onChange);
    await vi.advanceTimersByTimeAsync(0);

    expect(onChange).toHaveBeenLastCalledWith({ error: expect.any(Error) });

    global.fetch.mockResolvedValueOnce(jsonResponse(200, { run: { id: 'r1' } }));
    await vi.advanceTimersByTimeAsync(3000); // siguiente tick del polling

    expect(onChange).toHaveBeenLastCalledWith({ run: { id: 'r1' } });
  });
});
