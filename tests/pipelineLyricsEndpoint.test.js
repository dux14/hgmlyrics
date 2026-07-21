import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/_lib/db.js', () => ({ default: vi.fn() }));
vi.mock('../api/_lib/auth.js', () => ({
  requireAdmin: vi.fn(async () => ({ id: 'admin1', email: 'a@a.com' })),
}));
vi.mock('../api/songs/[id]/pipeline/_dispatch.js', () => ({
  dispatchPhase: vi.fn(async () => ({ id: 'call1' })),
}));

import sql from '../api/_lib/db.js';
import { requireAdmin } from '../api/_lib/auth.js';
import { dispatchPhase } from '../api/songs/[id]/pipeline/_dispatch.js';
import { initialPhases } from '../api/_lib/pipeline/state.js';
import lyricsHandler from '../api/songs/[id]/pipeline/lyrics.js';
import { makeRes } from './helpers/makeRes.js';

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ id: 'admin1', email: 'a@a.com' });
  dispatchPhase.mockResolvedValue({ id: 'call1' });
});

function routeSql(handlers) {
  sql.mockImplementation(async (strings, ...values) => {
    const text = strings.join('?');
    for (const [needle, result] of handlers) {
      if (text.includes(needle)) {
        if (typeof result === 'function') return result(values);
        if (result && result.__reject) return Promise.reject(result.__reject);
        return result;
      }
    }
    return [];
  });
  sql.json = (o) => o;
  // mismo patron que pipelineEndpoints.test.js: el mock no distingue tx
  // boundaries, corre el callback con el mismo sql (misma cola por texto).
  sql.begin = async (cb) => cb(sql);
}

function awaitingPhases() {
  const phases = initialPhases();
  phases.upload.status = 'done';
  phases.stems = { status: 'done', error: null, tracks: { lead: 'k-lead', backing: 'k-backing', vocals: 'k-vocals' }, artifacts: undefined };
  phases.transcription = { status: 'done', error: null, tracks: undefined, artifacts: undefined };
  return phases;
}

const dbSections = [
  { type: 'chorus', lines: [
    { text: 'Nadie me ama como tu me amas' },
    { text: 'y en la noche oscura brillara' },
  ] },
];
const canonicalContent = { secciones: [
  { tipo: 'chorus', lineas: [
    { texto: 'Nadie me ama como tú me amas' },
    { texto: 'y en la noche oscura brillará tu luz' },
  ] },
] };
const transcription = {
  text: 'nadie me ama como tu me amas y en la noche oscura brillara tu luz oooh oh',
  words: [
    { word: 'nadie', startMs: 0, endMs: 200 },
    { word: 'me', startMs: 210, endMs: 300 },
    { word: 'ama', startMs: 310, endMs: 500 },
    { word: 'como', startMs: 510, endMs: 700 },
    { word: 'tu', startMs: 710, endMs: 800 },
    { word: 'me', startMs: 810, endMs: 900 },
    { word: 'amas', startMs: 910, endMs: 1100 },
    { word: 'y', startMs: 1500, endMs: 1550 },
    { word: 'en', startMs: 1560, endMs: 1600 },
    { word: 'la', startMs: 1610, endMs: 1650 },
    { word: 'noche', startMs: 1660, endMs: 1900 },
    // gap de 400ms (>= BREATH_GAP_MS) antes de 'oscura': sugiere partir aqui.
    { word: 'oscura', startMs: 2300, endMs: 2500 },
    { word: 'brillara', startMs: 2510, endMs: 2700 },
    { word: 'tu', startMs: 2710, endMs: 2750 },
    { word: 'luz', startMs: 2760, endMs: 2900 },
  ],
  perLine: [
    { transIndex: 0, dbIndex: 0, score: 1.0 },
    { transIndex: 1, dbIndex: 1, score: 0.78 },
    { transIndex: 2, dbIndex: null, score: 0.0 },
  ],
  transLines: ['nadie me ama como tu me amas', 'y en la noche oscura brillara tu luz', 'oooh oh'],
};

function runRow(overrides = {}) {
  return {
    id: 'r1',
    songId: 's1',
    status: 'awaiting_lyrics',
    phases: awaitingPhases(),
    inputPath: 's1/runs/r1/full.mp3',
    inputMeta: { filename: 'sion.mp3', durationSec: 187 },
    lyricsReview: {},
    ...overrides,
  };
}

describe('GET /api/songs/:id/pipeline/lyrics', () => {
  it('404 si no hay un run en awaiting_lyrics', async () => {
    routeSql([['AS "lyricsReview"', []]]);
    const res = makeRes();
    await lyricsHandler({ method: 'GET', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('construye el review bajo demanda desde transcripcion+sections+canonica y lo persiste', async () => {
    let persistedReview;
    routeSql([
      ['AS "lyricsReview"', [runRow({ lyricsReview: { transcription } })]],
      ['SELECT sections FROM songs', [{ sections: dbSections }]],
      ['SELECT content FROM song_lyrics_canonical', [{ content: canonicalContent }]],
      ['UPDATE song_pipeline_runs SET lyrics_review', (values) => {
        persistedReview = values.find((v) => v && typeof v === 'object' && 'review' in v);
        return { count: 1 };
      }],
    ]);
    const res = makeRes();
    await lyricsHandler({ method: 'GET', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.review.sections[0].lines[1].conflict).toBe(true);
    expect(body.temperature).toBeLessThan(1);
    expect(body.canApprove).toBe(false); // conflicto sin resolver
    expect(persistedReview.review.sections[0].lines[1].conflict).toBe(true);
  });

  it('usa el review ya persistido sin reconstruirlo', async () => {
    const existingReview = {
      sections: [{ type: 'chorus', label: undefined, temperature: 1, lines: [
        { text: 'linea unica', conflict: false, vocalization: false, score: 1, sources: { db: 'linea unica', canonical: null, trans: null } },
      ] }],
      vocalizations: [],
      hasCanonical: false,
      temperature: 1,
    };
    let updateCalled = false;
    routeSql([
      ['AS "lyricsReview"', [runRow({ lyricsReview: { review: existingReview, transcription } })]],
      ['SELECT sections FROM songs', [{ sections: dbSections }]],
      ['UPDATE song_pipeline_runs SET lyrics_review', () => {
        updateCalled = true;
        return { count: 1 };
      }],
    ]);
    const res = makeRes();
    await lyricsHandler({ method: 'GET', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.review).toEqual(existingReview);
    expect(body.canApprove).toBe(true);
    expect(updateCalled).toBe(false);
  });

  it('devuelve suggestions con divisiones por respiracion mapeadas a la linea db', async () => {
    routeSql([
      ['AS "lyricsReview"', [runRow({ lyricsReview: { transcription } })]],
      ['SELECT sections FROM songs', [{ sections: dbSections }]],
      ['SELECT content FROM song_lyrics_canonical', [{ content: canonicalContent }]],
      ['UPDATE song_pipeline_runs SET lyrics_review', { count: 1 }],
    ]);
    const res = makeRes();
    await lyricsHandler({ method: 'GET', query: { id: 's1' } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.suggestions).toEqual([{ section: 0, line: 1, afterWords: [3] }]);
  });
});

describe('PUT /api/songs/:id/pipeline/lyrics', () => {
  it('404 si no hay un run en awaiting_lyrics', async () => {
    routeSql([['AS "lyricsReview"', []]]);
    const res = makeRes();
    await lyricsHandler({ method: 'PUT', query: { id: 's1' }, body: { action: { type: 'resolve', section: 0, line: 1, choice: 'db' } } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('400 si falta action', async () => {
    const res = makeRes();
    await lyricsHandler({ method: 'PUT', query: { id: 's1' }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('aplica la accion, persiste y devuelve temperatura recalculada', async () => {
    const existingReview = {
      sections: [{ type: 'chorus', label: undefined, temperature: 0.89, lines: [
        { text: 'y en la noche oscura brillara', conflict: true, vocalization: false, score: 0.78, sources: { db: 'y en la noche oscura brillara', canonical: 'y en la noche oscura brillará tu luz', trans: null } },
      ] }],
      vocalizations: [],
      hasCanonical: true,
      temperature: 0.89,
    };
    let persistedReview;
    routeSql([
      ['AS "lyricsReview"', [runRow({ lyricsReview: { review: existingReview } })]],
      ['UPDATE song_pipeline_runs SET lyrics_review', (values) => {
        persistedReview = values.find((v) => v && typeof v === 'object' && 'review' in v);
        return { count: 1 };
      }],
    ]);
    const res = makeRes();
    await lyricsHandler(
      { method: 'PUT', query: { id: 's1' }, body: { action: { type: 'resolve', section: 0, line: 0, choice: 'canonical' } } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.review.sections[0].lines[0].conflict).toBe(false);
    expect(body.review.sections[0].lines[0].text).toBe('y en la noche oscura brillará tu luz');
    expect(body.temperature).toBe(1);
    expect(body.canApprove).toBe(true);
    expect(persistedReview.review.sections[0].lines[0].text).toBe('y en la noche oscura brillará tu luz');
  });

  it('422 si la accion referencia un indice fuera de rango (RangeError)', async () => {
    const existingReview = {
      sections: [{ type: 'chorus', label: undefined, temperature: 1, lines: [
        { text: 'linea unica', conflict: false, vocalization: false, score: 1, sources: { db: 'linea unica', canonical: null, trans: null } },
      ] }],
      vocalizations: [],
      hasCanonical: false,
      temperature: 1,
    };
    routeSql([
      ['AS "lyricsReview"', [runRow({ lyricsReview: { review: existingReview } })]],
    ]);
    const res = makeRes();
    await lyricsHandler(
      { method: 'PUT', query: { id: 's1' }, body: { action: { type: 'resolve', section: 5, line: 0, choice: 'db' } } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('422 si la accion referencia un indice no numerico', async () => {
    const existingReview = {
      sections: [{ type: 'chorus', label: undefined, temperature: 1, lines: [
        { text: 'linea unica', conflict: false, vocalization: false, score: 1, sources: { db: 'linea unica', canonical: null, trans: null } },
      ] }],
      vocalizations: [],
      hasCanonical: false,
      temperature: 1,
    };
    routeSql([
      ['AS "lyricsReview"', [runRow({ lyricsReview: { review: existingReview } })]],
    ]);
    const res = makeRes();
    await lyricsHandler(
      { method: 'PUT', query: { id: 's1' }, body: { action: { type: 'resolve', section: 'abc', line: 0, choice: 'db' } } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it("422 si resolve trae choice:'edit' sin text (corromperia line.text en silencio)", async () => {
    const existingReview = {
      sections: [{ type: 'chorus', label: undefined, temperature: 1, lines: [
        { text: 'linea unica', conflict: false, vocalization: false, score: 1, sources: { db: 'linea unica', canonical: null, trans: null } },
      ] }],
      vocalizations: [],
      hasCanonical: false,
      temperature: 1,
    };
    let updateCalled = false;
    routeSql([
      ['AS "lyricsReview"', [runRow({ lyricsReview: { review: existingReview } })]],
      ['UPDATE song_pipeline_runs SET lyrics_review', () => {
        updateCalled = true;
        return { count: 1 };
      }],
    ]);
    const res = makeRes();
    await lyricsHandler(
      { method: 'PUT', query: { id: 's1' }, body: { action: { type: 'resolve', section: 0, line: 0, choice: 'edit' } } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(422);
    expect(updateCalled).toBe(false); // nunca llega a persistir el doc corrupto
  });

  it('422 si resolve trae un choice invalido (ni canonical/db/edit)', async () => {
    const existingReview = {
      sections: [{ type: 'chorus', label: undefined, temperature: 1, lines: [
        { text: 'linea unica', conflict: false, vocalization: false, score: 1, sources: { db: 'linea unica', canonical: null, trans: null } },
      ] }],
      vocalizations: [],
      hasCanonical: false,
      temperature: 1,
    };
    routeSql([
      ['AS "lyricsReview"', [runRow({ lyricsReview: { review: existingReview } })]],
    ]);
    const res = makeRes();
    await lyricsHandler(
      { method: 'PUT', query: { id: 's1' }, body: { action: { type: 'resolve', section: 0, line: 0, choice: 'typo' } } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('422 si splitLine no trae afterWord (undefined burla la comparacion numerica)', async () => {
    const existingReview = {
      sections: [{ type: 'chorus', label: undefined, temperature: 1, lines: [
        { text: 'una linea con varias palabras aqui', conflict: false, vocalization: false, score: 1, sources: { db: 'una linea con varias palabras aqui', canonical: null, trans: null } },
      ] }],
      vocalizations: [],
      hasCanonical: false,
      temperature: 1,
    };
    routeSql([
      ['AS "lyricsReview"', [runRow({ lyricsReview: { review: existingReview } })]],
    ]);
    const res = makeRes();
    await lyricsHandler(
      { method: 'PUT', query: { id: 's1' }, body: { action: { type: 'splitLine', section: 0, line: 0 } } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('422 si splitLine trae afterWord NaN', async () => {
    const existingReview = {
      sections: [{ type: 'chorus', label: undefined, temperature: 1, lines: [
        { text: 'una linea con varias palabras aqui', conflict: false, vocalization: false, score: 1, sources: { db: 'una linea con varias palabras aqui', canonical: null, trans: null } },
      ] }],
      vocalizations: [],
      hasCanonical: false,
      temperature: 1,
    };
    routeSql([
      ['AS "lyricsReview"', [runRow({ lyricsReview: { review: existingReview } })]],
    ]);
    const res = makeRes();
    await lyricsHandler(
      { method: 'PUT', query: { id: 's1' }, body: { action: { type: 'splitLine', section: 0, line: 0, afterWord: Number.NaN } } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(422);
  });
});

describe('POST /api/songs/:id/pipeline/lyrics (aprobar)', () => {
  function approvableReview() {
    return {
      sections: [{ type: 'chorus', label: undefined, temperature: 1, lines: [
        { text: 'nadie me ama como tu me amas', conflict: false, vocalization: false, score: 1, sources: { db: 'nadie me ama como tu me amas', canonical: null, trans: null } },
      ] }],
      vocalizations: [],
      hasCanonical: false,
      temperature: 1,
    };
  }

  it('404 si no hay un run en awaiting_lyrics', async () => {
    routeSql([['AS "lyricsReview"', []]]);
    const res = makeRes();
    await lyricsHandler({ method: 'POST', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('409 si todavia hay conflictos sin resolver (!canApprove)', async () => {
    const reviewWithConflict = {
      sections: [{ type: 'chorus', label: undefined, temperature: 0.5, lines: [
        { text: 'x', conflict: true, vocalization: false, score: 0.5, sources: { db: 'x', canonical: 'y', trans: null } },
      ] }],
      vocalizations: [],
      hasCanonical: true,
      temperature: 0.5,
    };
    routeSql([
      ['AS "lyricsReview"', [runRow({ lyricsReview: { review: reviewWithConflict } })]],
    ]);
    const res = makeRes();
    await lyricsHandler({ method: 'POST', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(dispatchPhase).not.toHaveBeenCalled();
  });

  it('feliz: publica sections, hace snapshot+hash, swap de audio, y despacha sync+pitch', async () => {
    let updatedSongSections;
    let mainRunUpdateValues;
    let insertedAudio;
    routeSql([
      ['AS "lyricsReview"', [runRow({ lyricsReview: { review: approvableReview() } })]],
      ['UPDATE songs SET sections', (values) => {
        updatedSongSections = values.find((v) => Array.isArray(v));
        return { count: 1 };
      }],
      // needle exclusivo del update combinado (phases+lyrics_review+status): el
      // update de solo-phases del fallback de dispatch no incluye "status = ".
      ['status = ', (values) => {
        mainRunUpdateValues = values;
        return { count: 1 };
      }],
      ['INSERT INTO song_audio', (values) => {
        insertedAudio = values;
        return { count: 1 };
      }],
    ]);
    const res = makeRes();
    await lyricsHandler({ method: 'POST', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    expect(updatedSongSections).toEqual(approvableReview().sections.map((s) => ({
      type: s.type,
      lines: [{ text: 'nadie me ama como tu me amas' }],
    })));

    const phasesArg = mainRunUpdateValues.find((v) => v && typeof v === 'object' && v.lyrics_review);
    expect(phasesArg.lyrics_review.status).toBe('done');

    const lyricsReviewArg = mainRunUpdateValues.find((v) => v && typeof v === 'object' && 'approvedHash' in v);
    expect(typeof lyricsReviewArg.approvedHash).toBe('string');

    expect(insertedAudio).toContain('s1/runs/r1/full.mp3');
    expect(insertedAudio).toContain(187);

    expect(dispatchPhase).toHaveBeenCalledWith('sync', expect.objectContaining({ id: 'r1', songId: 's1' }));
    expect(dispatchPhase).toHaveBeenCalledWith('pitch', expect.objectContaining({ id: 'r1', songId: 's1' }));
  });

  it('el fallo de dispatch (sync) NO rompe la respuesta 200; la fase queda failed', async () => {
    dispatchPhase.mockImplementation(async (phase) => {
      if (phase === 'sync') throw new Error('modal down');
      return { id: 'call1' };
    });
    let failedPhasesUpdate;
    routeSql([
      ['AS "lyricsReview"', [runRow({ lyricsReview: { review: approvableReview() } })]],
      ['UPDATE songs SET sections', { count: 1 }],
      // needle exclusivo del update combinado (phases+lyrics_review+status),
      // debe listarse ANTES del handler generico de abajo para no perder la
      // carrera de matching (ambos comparten el prefijo "SET phases = ").
      ['status = ', { count: 1 }],
      ['INSERT INTO song_audio', { count: 1 }],
      ['SELECT phases FROM song_pipeline_runs WHERE id = ', [{ phases: awaitingPhases() }]],
      // needle exclusivo del update de solo-phases (sin "status ="): el fallback
      // de fallo de dispatch de sync/pitch solo toca `phases`.
      ['SET phases = ', (values) => {
        const sync = values.find((v) => v && typeof v === 'object' && v.sync);
        if (sync) failedPhasesUpdate = sync;
        return { count: 1 };
      }],
    ]);
    const res = makeRes();
    await lyricsHandler({ method: 'POST', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(failedPhasesUpdate.sync.status).toBe('failed');
  });
});
