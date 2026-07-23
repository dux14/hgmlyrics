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
import lyricsHandler, { timingLinesFromSections } from '../api/songs/[id]/pipeline/lyrics.js';
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
  phases.stems = {
    status: 'done',
    error: null,
    tracks: { lead: 'k-lead', backing: 'k-backing', vocals: 'k-vocals' },
    artifacts: undefined,
  };
  phases.transcription = { status: 'done', error: null, tracks: undefined, artifacts: undefined };
  return phases;
}

// Transcripcion cruda (words + transLines) usada para probar la construccion
// del doc v2 (buildReviewDoc) y las sugerencias de division por respiracion.
// Solo 15 words para 7+8 palabras (transLines 0 y 1): transLine2 ('oooh oh')
// se queda sin words backing a proposito, igual que el fixture historico de
// F2 (perLine.dbIndex null para transIndex 2).
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

// Doc v2 ya construido y persistido (mismo shape que produce buildReviewDoc),
// para los tests que no necesitan reconstruirlo desde la transcripcion.
function existingReviewV2() {
  return {
    version: 2,
    sections: [
      {
        type: 'chorus',
        label: null,
        startMs: 0,
        endMs: 900,
        lines: [
          {
            text: 'linea unica',
            startMs: 0,
            endMs: 900,
            words: [],
            confidence: null,
            vocalization: true,
            breath: false,
            manualStartMs: null,
          },
        ],
      },
    ],
  };
}

describe('GET /api/songs/:id/pipeline/lyrics', () => {
  it('404 si no hay un run en awaiting_lyrics', async () => {
    routeSql([['AS "lyricsReview"', []]]);
    const res = makeRes();
    await lyricsHandler({ method: 'GET', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('construye el review v2 desde transcripcion+song_structure cuando no hay review (o es v1) y lo persiste con CAS', async () => {
    let updateCalled = false;
    routeSql([
      ['AS "lyricsReview"', [runRow({ lyricsReview: { transcription } })]],
      [
        'UPDATE song_pipeline_runs SET lyrics_review',
        () => {
          updateCalled = true;
          return { count: 1 };
        },
      ],
    ]);
    const res = makeRes();
    await lyricsHandler({ method: 'GET', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.review.version).toBe(2);
    expect(body.review.sections[0].lines).toHaveLength(3);
    expect(body.canApprove).toBe(true);
    // Sugerencia de division por respiracion (gap de 400ms) mapeada al renglon
    // 1 de la seccion 0 (segundo transLine, unico con words alineadas 1:1).
    expect(body.suggestions).toEqual([{ section: 0, line: 1, afterWords: [3] }]);
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('structure');
    expect(body).not.toHaveProperty('structureWarning');
    expect(updateCalled).toBe(true);
  });

  it('descarta un doc v1 en vuelo (sin version:2) y reconstruye desde la transcripcion', async () => {
    const v1Doc = { sections: [{ type: 'verse', lines: [{ text: 'viejo' }] }] };
    let updateCalled = false;
    routeSql([
      ['AS "lyricsReview"', [runRow({ lyricsReview: { review: v1Doc, transcription } })]],
      [
        'UPDATE song_pipeline_runs SET lyrics_review',
        () => {
          updateCalled = true;
          return { count: 1 };
        },
      ],
    ]);
    const res = makeRes();
    await lyricsHandler({ method: 'GET', query: { id: 's1' } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.review.version).toBe(2);
    expect(body.review.sections[0].lines).toHaveLength(3);
    expect(updateCalled).toBe(true);
  });

  it('usa el review v2 ya persistido sin reconstruirlo', async () => {
    let updateCalled = false;
    const review = existingReviewV2();
    routeSql([
      ['AS "lyricsReview"', [runRow({ lyricsReview: { review, transcription } })]],
      [
        'UPDATE song_pipeline_runs SET lyrics_review',
        () => {
          updateCalled = true;
          return { count: 1 };
        },
      ],
    ]);
    const res = makeRes();
    await lyricsHandler({ method: 'GET', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.review).toEqual(review);
    expect(body.canApprove).toBe(true);
    expect(updateCalled).toBe(false);
  });
});

describe('PUT /api/songs/:id/pipeline/lyrics', () => {
  it('404 si no hay un run en awaiting_lyrics', async () => {
    routeSql([['AS "lyricsReview"', []]]);
    const res = makeRes();
    await lyricsHandler(
      {
        method: 'PUT',
        query: { id: 's1' },
        body: { action: { type: 'resolve', section: 0, line: 1, choice: 'db' } },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('400 si falta action', async () => {
    const res = makeRes();
    await lyricsHandler({ method: 'PUT', query: { id: 's1' }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('editLine aplica el cambio de texto, persiste con CAS y devuelve canApprove (v2, sin temperature)', async () => {
    let updatedLyricsReview;
    routeSql([
      ['AS "lyricsReview"', [runRow({ lyricsReview: { review: existingReviewV2() } })]],
      [
        'UPDATE song_pipeline_runs SET lyrics_review',
        (values) => {
          updatedLyricsReview = values.find((v) => v && typeof v === 'object' && v.review);
          return { count: 1 };
        },
      ],
    ]);
    const res = makeRes();
    await lyricsHandler(
      {
        method: 'PUT',
        query: { id: 's1' },
        body: { action: { type: 'editLine', section: 0, line: 0, text: 'linea editada' } },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.review.sections[0].lines[0].text).toBe('linea editada');
    expect(body.canApprove).toBe(true);
    expect(body).not.toHaveProperty('temperature');
    expect(updatedLyricsReview.review.sections[0].lines[0].text).toBe('linea editada');
  });

  it('422 si la accion referencia un indice fuera de rango (RangeError)', async () => {
    routeSql([['AS "lyricsReview"', [runRow({ lyricsReview: { review: existingReviewV2() } })]]]);
    const res = makeRes();
    await lyricsHandler(
      {
        method: 'PUT',
        query: { id: 's1' },
        body: { action: { type: 'resolve', section: 5, line: 0, choice: 'db' } },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('422 si la accion referencia un indice no numerico', async () => {
    routeSql([['AS "lyricsReview"', [runRow({ lyricsReview: { review: existingReviewV2() } })]]]);
    const res = makeRes();
    await lyricsHandler(
      {
        method: 'PUT',
        query: { id: 's1' },
        body: { action: { type: 'resolve', section: 'abc', line: 0, choice: 'db' } },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it("422 si la accion es de un tipo desconocido (ej. 'resolve', eliminado en v2)", async () => {
    let updateCalled = false;
    routeSql([
      ['AS "lyricsReview"', [runRow({ lyricsReview: { review: existingReviewV2() } })]],
      [
        'UPDATE song_pipeline_runs SET lyrics_review',
        () => {
          updateCalled = true;
          return { count: 1 };
        },
      ],
    ]);
    const res = makeRes();
    await lyricsHandler(
      {
        method: 'PUT',
        query: { id: 's1' },
        body: { action: { type: 'resolve', section: 0, line: 0, choice: 'edit' } },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(422);
    expect(updateCalled).toBe(false); // nunca llega a persistir el doc corrupto
  });

  it('422 si splitLine no trae afterWord (undefined burla la comparacion numerica)', async () => {
    routeSql([['AS "lyricsReview"', [runRow({ lyricsReview: { review: existingReviewV2() } })]]]);
    const res = makeRes();
    await lyricsHandler(
      {
        method: 'PUT',
        query: { id: 's1' },
        body: { action: { type: 'splitLine', section: 0, line: 0 } },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('422 si splitLine trae afterWord NaN', async () => {
    routeSql([['AS "lyricsReview"', [runRow({ lyricsReview: { review: existingReviewV2() } })]]]);
    const res = makeRes();
    await lyricsHandler(
      {
        method: 'PUT',
        query: { id: 's1' },
        body: { action: { type: 'splitLine', section: 0, line: 0, afterWord: Number.NaN } },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(422);
  });
});

describe('PUT /api/songs/:id/pipeline/lyrics (reopen, Task 13)', () => {
  function approvedPhases(overrides = {}) {
    const phases = awaitingPhases();
    phases.lyrics_review = { status: 'done', error: null, tracks: undefined, artifacts: undefined };
    phases.sync = { status: 'done', error: null, tracks: undefined, artifacts: undefined };
    phases.pitch = { status: 'done', error: null, tracks: undefined, artifacts: undefined };
    phases.clips = { status: 'done', error: null, tracks: undefined, artifacts: undefined };
    return { ...phases, ...overrides };
  }

  it('run en running con letra aprobada: aplica phasesAfterLyricsEdit, lyrics_review vuelve a pending y el run a awaiting_lyrics', async () => {
    let updatedValues;
    routeSql([
      ['status IN (', [runRow({ status: 'running', phases: approvedPhases() })]],
      [
        'UPDATE song_pipeline_runs',
        (values) => {
          updatedValues = values;
          return { count: 1 };
        },
      ],
    ]);
    const res = makeRes();
    await lyricsHandler(
      { method: 'PUT', query: { id: 's1' }, body: { action: { type: 'reopen' } } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });

    const phasesArg = updatedValues.find((v) => v && typeof v === 'object' && v.lyrics_review);
    expect(phasesArg.sync.status).toBe('stale');
    expect(phasesArg.pitch.status).toBe('stale');
    expect(phasesArg.clips.status).toBe('stale');
    expect(phasesArg.lyrics_review.status).toBe('pending');
    expect(updatedValues).toContain('awaiting_lyrics');

    // Fix de review: approvedHash invalida a un centinela que jamas coincide
    // con un sha256 real, para que un webhook tardio referido al snapshot
    // pre-reopen quede stale en el guard de process.js (ver pipelineWebhook.test.js).
    const lyricsReviewArg = updatedValues.find(
      (v) => v && typeof v === 'object' && 'approvedHash' in v,
    );
    expect(lyricsReviewArg.approvedHash).toBe('reopened');
  });

  it('run en done con letra aprobada: mismo resultado (aplica la cascada y vuelve a awaiting_lyrics)', async () => {
    let updatedValues;
    routeSql([
      ['status IN (', [runRow({ status: 'done', phases: approvedPhases() })]],
      [
        'UPDATE song_pipeline_runs',
        (values) => {
          updatedValues = values;
          return { count: 1 };
        },
      ],
    ]);
    const res = makeRes();
    await lyricsHandler(
      { method: 'PUT', query: { id: 's1' }, body: { action: { type: 'reopen' } } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(updatedValues).toContain('awaiting_lyrics');
  });

  it('409 si el UPDATE choca con otro run activo (23505 song_pipeline_runs_one_active_per_song)', async () => {
    const dup = new Error('duplicate key value violates unique constraint');
    dup.code = '23505';
    dup.constraint_name = 'song_pipeline_runs_one_active_per_song';
    routeSql([
      ['status IN (', [runRow({ status: 'running', phases: approvedPhases() })]],
      ['UPDATE song_pipeline_runs', { __reject: dup }],
    ]);
    const res = makeRes();
    await lyricsHandler(
      { method: 'PUT', query: { id: 's1' }, body: { action: { type: 'reopen' } } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Ya hay otra ejecución activa para esta canción',
    });
  });

  it('409 si no hay ningun run en running/done (p.ej. sigue en awaiting_lyrics, letra sin aprobar)', async () => {
    routeSql([['status IN (', []]]);
    const res = makeRes();
    await lyricsHandler(
      { method: 'PUT', query: { id: 's1' }, body: { action: { type: 'reopen' } } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'No hay una letra aprobada para reabrir' });
  });

  it('409 si el run activo esta failed/cancelled/superseded (no matchea running/done)', async () => {
    routeSql([['status IN (', []]]);
    const res = makeRes();
    await lyricsHandler(
      { method: 'PUT', query: { id: 's1' }, body: { action: { type: 'reopen' } } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe('POST /api/songs/:id/pipeline/lyrics (aprobar)', () => {
  // Doc v2 aprobable con 3 renglones: el del medio sin timing (interpola en
  // el shim de song_line_timings), los otros dos con timing real.
  function approvableReviewV2() {
    return {
      version: 2,
      sections: [
        {
          type: 'chorus',
          label: null,
          startMs: 0,
          endMs: 3000,
          lines: [
            {
              text: 'nadie me ama',
              startMs: 0,
              endMs: 900,
              words: [],
              confidence: 0.9,
              vocalization: false,
              breath: false,
              manualStartMs: null,
            },
            {
              text: 'como tu me amas',
              startMs: null,
              endMs: null,
              words: [],
              confidence: null,
              vocalization: true,
              breath: false,
              manualStartMs: null,
            },
            {
              text: 'y en la noche',
              startMs: 2500,
              endMs: 3000,
              words: [],
              confidence: 0.8,
              vocalization: false,
              breath: false,
              manualStartMs: null,
            },
          ],
        },
      ],
    };
  }

  it('404 si no hay un run en awaiting_lyrics', async () => {
    routeSql([['AS "lyricsReview"', []]]);
    const res = makeRes();
    await lyricsHandler({ method: 'POST', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('409 si canApprove es false (doc v2 sin renglones)', async () => {
    const emptyReview = {
      version: 2,
      sections: [{ type: 'verse', label: null, startMs: 0, endMs: 0, lines: [] }],
    };
    routeSql([['AS "lyricsReview"', [runRow({ lyricsReview: { review: emptyReview } })]]]);
    const res = makeRes();
    await lyricsHandler({ method: 'POST', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('feliz: escribe al store propio (song_pipeline_lyrics), NO pisa songs.sections, shim de timing a song_line_timings, sync=done, pitch/clips=running, y despacha SOLO pitch+clips', async () => {
    let songsSectionsTouched = false;
    let pipelineLyricsUpsert;
    let timingShimInsert;
    let mainRunUpdate;
    routeSql([
      ['AS "lyricsReview"', [runRow({ lyricsReview: { review: approvableReviewV2() } })]],
      [
        'UPDATE songs SET sections',
        () => {
          songsSectionsTouched = true;
          return { count: 1 };
        },
      ],
      [
        'INSERT INTO song_pipeline_lyrics',
        (values) => {
          pipelineLyricsUpsert = values;
          return { count: 1 };
        },
      ],
      [
        'INSERT INTO song_line_timings',
        (values) => {
          timingShimInsert = values;
          return { count: 1 };
        },
      ],
      [
        'lyrics_review = ',
        (values) => {
          mainRunUpdate = values;
          return { count: 1 };
        },
      ],
      ['INSERT INTO song_audio', { count: 1 }],
    ]);
    const res = makeRes();
    await lyricsHandler({ method: 'POST', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });

    // El cancionero (songs.sections) NUNCA se toca: la letra manual queda intacta.
    expect(songsSectionsTouched).toBe(false);
    expect(pipelineLyricsUpsert).toBeDefined();
    expect(pipelineLyricsUpsert).toContain('s1');
    expect(pipelineLyricsUpsert).toContain('r1');

    const lines = timingShimInsert.find((v) => Array.isArray(v));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ i: 0, startMs: 0, interpolated: false });
    // Renglon del medio sin timing: interpola el punto medio (0+2500)/2=1250.
    expect(lines[1]).toMatchObject({ i: 1, startMs: 1250, interpolated: true });
    expect(lines[2]).toMatchObject({ i: 2, startMs: 2500, interpolated: false });
    // 'ready'/'pipeline' son literales inline en el INSERT (no placeholders),
    // ya verificados por lectura del código; acá solo importan los binds.
    expect(timingShimInsert).toContain('s1');

    const phasesArg = mainRunUpdate.find((v) => v && typeof v === 'object' && v.lyrics_review);
    expect(phasesArg.sync.status).toBe('done');
    expect(phasesArg.pitch.status).toBe('running');
    expect(phasesArg.clips.status).toBe('running');

    expect(dispatchPhase).toHaveBeenCalledWith('pitch', expect.anything());
    expect(dispatchPhase).toHaveBeenCalledWith('clips', expect.anything());
    expect(dispatchPhase).not.toHaveBeenCalledWith('sync', expect.anything());
  });

  it('resetea retries de pitch/clips a 0 al re-aprobar aunque vengan de un ciclo previo con retries>0 (fix Important MAX_RETRIES acumulativo)', async () => {
    let mainRunUpdateValues;
    const phasesWithStaleRetries = awaitingPhases();
    phasesWithStaleRetries.pitch = {
      status: 'stale',
      error: null,
      tracks: undefined,
      artifacts: undefined,
      retries: 3,
    };
    phasesWithStaleRetries.clips = {
      status: 'stale',
      error: null,
      tracks: undefined,
      artifacts: undefined,
      retries: 2,
    };
    routeSql([
      [
        'AS "lyricsReview"',
        [runRow({ phases: phasesWithStaleRetries, lyricsReview: { review: approvableReviewV2() } })],
      ],
      [
        'lyrics_review = ',
        (values) => {
          mainRunUpdateValues = values;
          return { count: 1 };
        },
      ],
      ['INSERT INTO song_audio', { count: 1 }],
    ]);
    const res = makeRes();
    await lyricsHandler({ method: 'POST', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);

    const phasesArg = mainRunUpdateValues.find((v) => v && typeof v === 'object' && v.lyrics_review);
    expect(phasesArg.sync.status).toBe('done');
    expect(phasesArg.pitch.status).toBe('running');
    expect(phasesArg.clips.status).toBe('running');
    expect(phasesArg.pitch.retries).toBe(0);
    expect(phasesArg.clips.retries).toBe(0);
  });

  it('sin durationSec en input_meta: el swap de audio queda con duration_sec null', async () => {
    let insertedAudio;
    routeSql([
      [
        'AS "lyricsReview"',
        [
          runRow({
            inputMeta: { filename: 'sion.mp3' },
            lyricsReview: { review: approvableReviewV2() },
          }),
        ],
      ],
      ['lyrics_review = ', { count: 1 }],
      [
        'INSERT INTO song_audio',
        (values) => {
          insertedAudio = values;
          return { count: 1 };
        },
      ],
    ]);
    const res = makeRes();
    await lyricsHandler({ method: 'POST', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(insertedAudio).toContain('s1/runs/r1/full.mp3');
    expect(insertedAudio).toContain(null);
  });

  it('el fallo de dispatch (pitch) NO rompe la respuesta 200; la fase queda failed', async () => {
    dispatchPhase.mockImplementation(async (phase) => {
      if (phase === 'pitch') throw new Error('modal down');
      return { id: 'call1' };
    });
    let failedPhasesUpdate;
    routeSql([
      ['AS "lyricsReview"', [runRow({ lyricsReview: { review: approvableReviewV2() } })]],
      // needle exclusivo del update combinado (phases+lyrics_review+status),
      // debe listarse ANTES del handler generico de abajo para no perder la
      // carrera de matching (ambos comparten el prefijo "SET phases = ").
      ['lyrics_review = ', { count: 1 }],
      ['INSERT INTO song_audio', { count: 1 }],
      ['SELECT phases FROM song_pipeline_runs WHERE id = ', [{ phases: awaitingPhases() }]],
      // needle exclusivo del update de solo-phases (sin "lyrics_review ="): el
      // fallback de fallo de dispatch de pitch/clips solo toca `phases`.
      [
        'SET phases = ',
        (values) => {
          const pitch = values.find((v) => v && typeof v === 'object' && v.pitch);
          if (pitch) failedPhasesUpdate = pitch;
          return { count: 1 };
        },
      ],
    ]);
    const res = makeRes();
    await lyricsHandler({ method: 'POST', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(failedPhasesUpdate.pitch.status).toBe('failed');
  });
});

describe('timingLinesFromSections', () => {
  const mkSection = (lines) => ({ type: 'verse', label: null, startMs: 0, endMs: 0, lines });
  const mkLine = (startMs, confidence = null) => ({
    text: 'x',
    startMs,
    endMs: startMs,
    words: [],
    confidence,
    vocalization: false,
    breath: false,
    manualStartMs: null,
  });

  it('interpola el hueco interior con el punto medio entre vecinas conocidas', () => {
    const sections = [mkSection([mkLine(0), mkLine(null), mkLine(1000)])];
    const lines = timingLinesFromSections(sections);
    expect(lines[0]).toMatchObject({ i: 0, startMs: 0, interpolated: false });
    expect(lines[1]).toMatchObject({ i: 1, startMs: 500, interpolated: true });
    expect(lines[2]).toMatchObject({ i: 2, startMs: 1000, interpolated: false });
  });

  it('fuerza monotonia estricta cuando dos renglones comparten el mismo startMs', () => {
    const sections = [mkSection([mkLine(0), mkLine(0), mkLine(1)])];
    const lines = timingLinesFromSections(sections);
    expect(lines[0].startMs).toBe(0);
    expect(lines[1].startMs).toBeGreaterThan(lines[0].startMs);
    expect(lines[2].startMs).toBeGreaterThan(lines[1].startMs);
  });

  it('doc sin ningun timing: sigue emitiendo startMs monotonicos crecientes', () => {
    const sections = [mkSection([mkLine(null), mkLine(null)])];
    const lines = timingLinesFromSections(sections);
    expect(lines[0].interpolated).toBe(true);
    expect(lines[1].interpolated).toBe(true);
    expect(lines[1].startMs).toBeGreaterThan(lines[0].startMs);
  });
});
