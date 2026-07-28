// tests/apiSongsLyricsSync.test.js — PUT /api/songs/[id].js: sincronía entre
// el cancionero (songs.sections) y la letra aprobada del pipeline
// (song_pipeline_lyrics). Mismo estilo de mocks que apiSongsAtomicLinks.test.js.
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
process.env.DATABASE_URL = 'postgresql://test';

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: vi.fn() } }),
}));

// prevRow.sections viaja por test (distingue el caso "sections cambiaron").
let prevSections = null;

const mockTx = vi.fn(async () => ({ count: 1 }));
const mockSqlFn = vi.fn(async (strings) => {
  if (strings?.raw && strings.join('').trim().startsWith('SELECT')) {
    return [{ sections: prevSections }];
  }
  return { count: 1 };
});
const mockSql = Object.assign(mockSqlFn, {
  begin: vi.fn(async (cb) => cb(mockTx)),
  json: (v) => v,
});
vi.mock('../api/_lib/db.js', () => ({ default: mockSql }));

vi.mock('../api/_lib/auth.js', () => ({
  requireAdmin: vi.fn(async () => {}),
}));
vi.mock('../api/_lib/http.js', () => ({
  allowMethods: vi.fn(() => false),
  withErrors: (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      res.status(e?.status ?? 500).json({ error: e?.message ?? 'Error' });
    }
  },
}));
vi.mock('../src/lib/musicKeys.js', () => ({ isValidKey: () => true }));
vi.mock('../src/lib/voiceSystem.js', () => ({
  validateSongV2: vi.fn(),
  validateSongV3: vi.fn(),
}));

const getPipelineLyrics = vi.fn(async () => null);
const upsertPipelineLyrics = vi.fn(async () => ({ count: 1 }));
vi.mock('../api/_lib/pipeline/lyricsStore.js', () => ({
  getPipelineLyrics: (...args) => getPipelineLyrics(...args),
  upsertPipelineLyrics: (...args) => upsertPipelineLyrics(...args),
}));

const propagateSongbookText = vi.fn(() => null);
vi.mock('../api/_lib/pipeline/songbookSync.js', () => ({
  propagateSongbookText: (...args) => propagateSongbookText(...args),
}));

function makeRes() {
  const res = { _status: 200, _body: null };
  res.status = (s) => {
    res._status = s;
    return res;
  };
  res.json = (b) => {
    res._body = b;
    return res;
  };
  return res;
}

function updateCallsFor(fragment) {
  return mockSqlFn.mock.calls.filter(
    (args) =>
      Array.isArray(args[0]) &&
      args[0].raw &&
      args[0].some((s) => typeof s === 'string' && s.includes(fragment)),
  );
}

const handler = (await import('../api/songs/[id].js')).default;

function makeReq(body) {
  return { method: 'PUT', query: { id: 'song-1' }, body };
}

const PIPELINE_LYRICS = {
  songId: 'song-1',
  runId: 'run-1',
  hash: 'hash-viejo',
  language: 'es',
  sections: [{ type: 'verse', label: null, lines: [{ text: 'linea vieja' }] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  prevSections = null;
  mockSql.begin.mockImplementation(async (cb) => cb(mockTx));
  mockTx.mockResolvedValue({ count: 1 });
  getPipelineLyrics.mockResolvedValue(null);
  upsertPipelineLyrics.mockResolvedValue({ count: 1 });
  propagateSongbookText.mockReturnValue(null);
});

describe('PUT /api/songs/[id].js — lyricsSync', () => {
  it('canción sin letra de pipeline: lyricsSync "none", comportamiento intacto (marca stale si cambió)', async () => {
    prevSections = [{ lines: [{ text: 'vieja' }] }];
    const req = makeReq({ title: 'X', sections: [{ lines: [{ text: 'nueva' }] }] });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ success: true, lyricsSync: 'none' });
    expect(upsertPipelineLyrics).not.toHaveBeenCalled();
    expect(updateCallsFor("SET status = 'stale'")).toHaveLength(1);
  });

  it('sections sin cambios: lyricsSync "none", no toca song_pipeline_lyrics ni song_line_timings', async () => {
    prevSections = [{ lines: [{ text: 'igual' }] }];
    getPipelineLyrics.mockResolvedValue(PIPELINE_LYRICS);
    const req = makeReq({ title: 'X', sections: [{ lines: [{ text: 'igual' }] }] });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.lyricsSync).toBe('none');
    expect(upsertPipelineLyrics).not.toHaveBeenCalled();
    expect(updateCallsFor("SET status = 'stale'")).toHaveLength(0);
  });

  it('mismo número de renglones canónicos: propaga al store, conserva hash/runId, no marca stale', async () => {
    prevSections = [{ lines: [{ text: 'linea vieja' }] }];
    getPipelineLyrics.mockResolvedValue(PIPELINE_LYRICS);
    const propagated = [{ type: 'verse', label: null, lines: [{ text: 'línea nueva' }] }];
    propagateSongbookText.mockReturnValue(propagated);

    const req = makeReq({ title: 'X', sections: [{ lines: [{ text: 'línea nueva' }] }] });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ success: true, lyricsSync: 'propagated' });
    expect(upsertPipelineLyrics).toHaveBeenCalledTimes(1);
    expect(upsertPipelineLyrics).toHaveBeenCalledWith(mockSql, {
      songId: 'song-1',
      runId: PIPELINE_LYRICS.runId,
      sections: propagated,
      hash: PIPELINE_LYRICS.hash,
      language: PIPELINE_LYRICS.language,
    });
    expect(updateCallsFor("SET status = 'stale'")).toHaveLength(0);
  });

  it('número de renglones canónicos distinto: no propaga, marca stale y responde lyricsSync "diverged"', async () => {
    prevSections = [{ lines: [{ text: 'linea vieja' }] }];
    getPipelineLyrics.mockResolvedValue(PIPELINE_LYRICS);
    propagateSongbookText.mockReturnValue(null);

    const req = makeReq({
      title: 'X',
      sections: [{ lines: [{ text: 'linea vieja' }, { text: 'linea agregada' }] }],
    });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ success: true, lyricsSync: 'diverged' });
    expect(upsertPipelineLyrics).not.toHaveBeenCalled();
    expect(updateCallsFor("SET status = 'stale'")).toHaveLength(1);
  });
});
