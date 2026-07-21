/**
 * apiAlign.test.js — TDD para el dispatch de forced alignment a Modal
 * (api/_lib/align.js: projectCanonicalLines + dispatchAlign).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: vi.fn() } }),
}));

// sql mock: cola de respuestas (FIFO) + registro de llamadas para inspeccionar el SQL emitido.
let sqlResponses = [];
const sqlCalls = [];
function sqlMock(strings, ...values) {
  if (!strings?.raw) return strings;
  sqlCalls.push({ text: strings.join('?').replace(/\s+/g, ' ').trim(), values });
  return Promise.resolve(sqlResponses.shift() ?? []);
}
sqlMock.json = (v) => v;
vi.mock('../api/_lib/db.js', () => ({ default: sqlMock }));

vi.mock('../api/_lib/http.js', () => ({
  allowMethods: vi.fn(() => false),
  withErrors: (fn) => fn,
  fetchWithTimeout: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../api/_lib/storage.js', () => ({
  signSongAudioDownload: vi.fn((key) => Promise.resolve(`https://get/${key}`)),
}));

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
process.env.DATABASE_URL = 'postgresql://test';
process.env.MODAL_ALIGN_ENDPOINT = 'https://modal.example/align';
process.env.MODAL_INBOUND_SECRET = 'inbound-secret';
process.env.PUBLIC_BASE_URL = 'https://hgmlyrics.vercel.app';

const { dispatchAlign, projectCanonicalLines } = await import('../api/_lib/align.js');
const { fetchWithTimeout } = await import('../api/_lib/http.js');
const { signSongAudioDownload } = await import('../api/_lib/storage.js');

// Fixture "Santo": secciones con lineas de annotation y spoken (misma fixture
// que reutiliza C3 en src/lib/projectLines.js para garantizar paridad front/back).
const SANTO_SECTIONS = [
  {
    type: 'verse',
    lines: [
      { text: 'Santo, Santo, Santo' },
      { text: '(instrumental)', annotation: true },
      { text: 'Por eso con los ángeles, diciendo:', spoken: true },
    ],
  },
  {
    type: 'chorus',
    lines: [{ text: '(x2)', annotation: true }, { text: 'Es el Señor' }],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  sqlResponses = [];
  sqlCalls.length = 0;
  fetchWithTimeout.mockResolvedValue({ ok: true });
});

describe('projectCanonicalLines', () => {
  it('salta annotation, conserva spoken, reindexa i de forma continua entre secciones', () => {
    expect(projectCanonicalLines(SANTO_SECTIONS)).toEqual([
      { i: 0, text: 'Santo, Santo, Santo' },
      { i: 1, text: 'Por eso con los ángeles, diciendo:' },
      { i: 2, text: 'Es el Señor' },
    ]);
  });

  it('sin secciones → []', () => {
    expect(projectCanonicalLines(undefined)).toEqual([]);
    expect(projectCanonicalLines([])).toEqual([]);
  });
});

describe('dispatchAlign', () => {
  it('sin fila song_audio → lanza 409 Sin audio', async () => {
    sqlResponses.push([]); // SELECT song_audio
    await expect(dispatchAlign('song-1')).rejects.toMatchObject({
      status: 409,
      message: 'Sin audio',
    });
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("song_line_timings ya 'processing' → no-op, no postea a Modal", async () => {
    sqlResponses.push([{ storageKey: 'song-1/full.mp3' }]); // SELECT song_audio
    sqlResponses.push([{ status: 'processing' }]); // SELECT song_line_timings
    await dispatchAlign('song-1');
    expect(fetchWithTimeout).not.toHaveBeenCalled();
    expect(signSongAudioDownload).not.toHaveBeenCalled();
    const upsert = sqlCalls.find((c) => c.text.startsWith('INSERT INTO song_line_timings'));
    expect(upsert).toBeUndefined();
  });

  it('marca processing ANTES de postear y postea a Modal con el payload firmado', async () => {
    sqlResponses.push([{ storageKey: 'song-1/full.mp3' }]); // SELECT song_audio
    sqlResponses.push([{ status: 'ready' }]); // SELECT song_line_timings (re-dispara)
    sqlResponses.push([{ sections: SANTO_SECTIONS }]); // SELECT songs
    sqlResponses.push([]); // INSERT ... ON CONFLICT processing

    let sqlCallsAtPostTime = null;
    fetchWithTimeout.mockImplementationOnce(async () => {
      sqlCallsAtPostTime = [...sqlCalls];
      return { ok: true };
    });

    await dispatchAlign('song-1');

    const upsert = sqlCallsAtPostTime.find((c) =>
      c.text.startsWith('INSERT INTO song_line_timings'),
    );
    expect(upsert).toBeTruthy();
    expect(upsert.text).toContain('processing');

    expect(signSongAudioDownload).toHaveBeenCalledWith('song-1/full.mp3');
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    const [endpoint, opts] = fetchWithTimeout.mock.calls[0];
    expect(endpoint).toBe('https://modal.example/align');
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-inbound-secret']).toBe('inbound-secret');
    const body = JSON.parse(opts.body);
    expect(body).toEqual({
      songId: 'song-1',
      audioUrl: 'https://get/song-1/full.mp3',
      lines: [
        { i: 0, text: 'Santo, Santo, Santo' },
        { i: 1, text: 'Por eso con los ángeles, diciendo:' },
        { i: 2, text: 'Es el Señor' },
      ],
      webhookUrl: 'https://hgmlyrics.vercel.app/api/align/webhook',
    });
  });

  it('con snapshotHash → viaja en el payload posteado a Modal (fase sync del pipeline)', async () => {
    sqlResponses.push([{ storageKey: 'song-1/full.mp3' }]); // SELECT song_audio
    sqlResponses.push([{ status: 'ready' }]); // SELECT song_line_timings
    sqlResponses.push([{ sections: [] }]); // SELECT songs
    sqlResponses.push([]); // INSERT ... processing

    await dispatchAlign('song-1', 'hash123');

    const [, opts] = fetchWithTimeout.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.snapshotHash).toBe('hash123');
  });

  it('Modal responde non-2xx → marca failed con el error y relanza', async () => {
    sqlResponses.push([{ storageKey: 'song-1/full.mp3' }]); // SELECT song_audio
    sqlResponses.push([]); // SELECT song_line_timings (sin fila -> pending)
    sqlResponses.push([{ sections: [] }]); // SELECT songs
    sqlResponses.push([]); // INSERT ... processing
    fetchWithTimeout.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: async () => 'boom',
    });

    await expect(dispatchAlign('song-1')).rejects.toThrow(/Modal 502/);

    const failedUpdate = sqlCalls[sqlCalls.length - 1];
    expect(failedUpdate.text).toContain('failed');
  });

  it('el POST a Modal lanza (fallo de red) → marca failed y relanza', async () => {
    sqlResponses.push([{ storageKey: 'song-1/full.mp3' }]); // SELECT song_audio
    sqlResponses.push([{ status: 'failed' }]); // SELECT song_line_timings (re-dispara)
    sqlResponses.push([{ sections: [] }]); // SELECT songs
    sqlResponses.push([]); // INSERT ... processing
    fetchWithTimeout.mockRejectedValueOnce(new Error('network down'));

    await expect(dispatchAlign('song-1')).rejects.toThrow('network down');

    const failedUpdate = sqlCalls[sqlCalls.length - 1];
    expect(failedUpdate.text).toContain('failed');
  });
});
