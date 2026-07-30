/**
 * apiSongPitchNotes.test.js — TDD de /api/songs/[id]/pitch-notes: lectura de
 * song_pitch_analysis para el editor del cancionero. Proyector delgado, sin
 * firmas de Storage y sin depender de que la canción tenga stems (por eso no
 * sirve /studio). 200 con hasAnalysis:false cuando la canción no tiene tono.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: vi.fn() } }),
}));

let sqlResponses = [];
const sqlCalls = [];
function sqlMock(strings, ...values) {
  if (!strings?.raw) return strings;
  sqlCalls.push({ text: strings.join('?').replace(/\s+/g, ' ').trim(), values });
  return Promise.resolve(sqlResponses.shift() ?? []);
}
sqlMock.json = (v) => v;
vi.mock('../api/_lib/db.js', () => ({ default: sqlMock }));

vi.mock('../api/_lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ id: 'user-1' })),
}));
vi.mock('../api/_lib/http.js', () => ({
  allowMethods: vi.fn(() => false),
  withErrors: (fn) => fn,
}));

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
process.env.DATABASE_URL = 'postgresql://test';

const handler = (await import('../api/songs/[id]/pitch-notes.js')).default;
const { requireUser } = await import('../api/_lib/auth.js');

function makeRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
}

const ANALYSIS = {
  voices_present: ['lead', 'backing', 'female'],
  modulations: [{ at: 12.5, from: 'C', to: 'D' }],
  voices: {
    lead: {
      lines: [
        {
          syllables: [
            {
              text: 'Que',
              start: 22.172,
              end: 22.454,
              midi: 59,
              note: 'B3',
              cents: -7,
              ditto: false,
              blank: false,
              score: 0.705,
            },
          ],
        },
      ],
    },
    backing: { lines: [{ syllables: [] }] },
    // Género y coro: eventos de nota sueltos, sin letra. No sirven.
    female: { notes: [{ start: 1, end: 2, midi: 60, note: 'C4', cents: 0 }] },
  },
};

beforeEach(() => {
  sqlResponses = [];
  sqlCalls.length = 0;
  requireUser.mockClear();
});

describe('GET /api/songs/[id]/pitch-notes', () => {
  it('proyecta las líneas con sus sílabas y descarta lo que no sirve', async () => {
    sqlResponses.push([{ analysis: ANALYSIS }]);
    const res = makeRes();
    await handler({ method: 'GET', query: { id: 'song-1' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.hasAnalysis).toBe(true);
    expect(res.body.voicesPresent).toEqual(['lead', 'backing']);
    expect(res.body.voices.female).toBeUndefined();
    expect(res.body.voices.lead.lines[0]).toEqual({
      i: 0,
      syllables: [
        { text: 'Que', start: 22.172, end: 22.454, midi: 59, note: 'B3', cents: -7 },
      ],
    });
  });

  it('no expone modulations ni los campos derivables de la sílaba', async () => {
    sqlResponses.push([{ analysis: ANALYSIS }]);
    const res = makeRes();
    await handler({ method: 'GET', query: { id: 'song-1' } }, res);

    expect(res.body.modulations).toBeUndefined();
    const syl = res.body.voices.lead.lines[0].syllables[0];
    expect(syl.ditto).toBeUndefined();
    expect(syl.blank).toBeUndefined();
    expect(syl.score).toBeUndefined();
  });

  it('devuelve 200 con hasAnalysis false cuando la canción no tiene tono', async () => {
    sqlResponses.push([]);
    const res = makeRes();
    await handler({ method: 'GET', query: { id: 'song-1' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ hasAnalysis: false, voicesPresent: [], voices: {} });
  });

  it('consulta song_pitch_analysis por canción', async () => {
    sqlResponses.push([{ analysis: ANALYSIS }]);
    await handler({ method: 'GET', query: { id: 'song-42' } }, makeRes());

    expect(sqlCalls[0].text).toContain('FROM song_pitch_analysis');
    expect(sqlCalls[0].values).toEqual(['song-42']);
  });

  it('exige usuario autenticado', async () => {
    sqlResponses.push([{ analysis: ANALYSIS }]);
    await handler({ method: 'GET', query: { id: 'song-1' } }, makeRes());

    expect(requireUser).toHaveBeenCalledTimes(1);
  });

  it('400 sin id', async () => {
    const res = makeRes();
    await handler({ method: 'GET', query: {} }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('id is required');
  });
});
