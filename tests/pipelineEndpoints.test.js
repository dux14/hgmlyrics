import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/_lib/db.js', () => ({ default: vi.fn() }));
vi.mock('../api/_lib/auth.js', () => ({
  requireAdmin: vi.fn(async () => ({ id: 'admin1', email: 'a@a.com' })),
}));
vi.mock('../api/_lib/storage.js', () => ({
  pipelineInputKey: (songId, runId) => `${songId}/runs/${runId}/full.mp3`,
  createSongAudioSignedPutUrl: vi.fn(async (key) => `https://signed/put/${key}`),
  signSongAudioDownload: vi.fn(async (key) => `https://signed/get/${key}`),
  signSongAudioDownloads: vi.fn(async (keys) => keys.map((k) => `https://signed/get/${k}`)),
  pipelineInputStat: vi.fn(async () => ({ exists: true, size: 1024 })),
  pipelineStemKey: (songId, kind) => `${songId}/stems/${kind}.mp3`,
  deleteSongAudioObjects: vi.fn(async () => {}),
}));
vi.mock('../api/pitch/_lib/storage.js', () => ({
  deletePitchPrefix: vi.fn(async () => {}),
}));
vi.mock('../api/songs/[id]/pipeline/_dispatch.js', () => ({
  dispatchPhase: vi.fn(async () => ({ id: 'call1' })),
}));

import sql from '../api/_lib/db.js';
import { requireAdmin } from '../api/_lib/auth.js';
import * as storage from '../api/_lib/storage.js';
import { pipelineInputStat, createSongAudioSignedPutUrl } from '../api/_lib/storage.js';
import { deletePitchPrefix } from '../api/pitch/_lib/storage.js';
import { dispatchPhase } from '../api/songs/[id]/pipeline/_dispatch.js';
import { initialPhases } from '../api/_lib/pipeline/state.js';
import pipelineHandler from '../api/songs/[id]/pipeline.js';
import confirmHandler from '../api/songs/[id]/pipeline/confirm.js';
import retryHandler from '../api/songs/[id]/pipeline/retry.js';
import { makeRes } from './helpers/makeRes.js';

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks no resetea implementaciones seteadas con mockResolvedValue/
  // mockRejectedValue en un test previo (solo limpia el historial de llamadas)
  // — se re-arma el default acá para que no se filtre entre tests.
  requireAdmin.mockResolvedValue({ id: 'admin1', email: 'a@a.com' });
  dispatchPhase.mockResolvedValue({ id: 'call1' });
  pipelineInputStat.mockResolvedValue({ exists: true, size: 1024 });
});

// Textos crudos de todas las queries emitidas en el test actual (Task 8:
// permite asertar por negativo, p.ej. "ninguna query toca songs.sections").
let capturedQueries = [];

function routeSql(handlers) {
  capturedQueries = [];
  sql.mockImplementation(async (strings, ...values) => {
    const text = strings.join('?');
    capturedQueries.push(text);
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
  // retry.js usa sql.begin para el claim transaccional (FOR UPDATE); el mock
  // no distingue tx boundaries, así que corre el callback con el mismo sql
  // (misma cola de handlers por texto, funciona igual dentro o fuera de tx).
  sql.begin = async (cb) => cb(sql);
}

describe('POST /api/songs/:id/pipeline (crear run)', () => {
  it('403 si no es admin', async () => {
    requireAdmin.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    const res = makeRes();
    await pipelineHandler(
      { method: 'POST', query: { id: 's1' }, body: { filename: 'a.mp3' } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('404 si la canción no existe', async () => {
    routeSql([['SELECT id, title FROM songs', []]]);
    const res = makeRes();
    await pipelineHandler(
      { method: 'POST', query: { id: 's1' }, body: { filename: 'a.mp3' } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('409 si ya hay un run activo (23505)', async () => {
    const dup = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint_name: 'song_pipeline_runs_one_active_per_song',
    });
    routeSql([
      ['SELECT id, title FROM songs', [{ id: 's1', title: 'Sion' }]],
      ['INSERT INTO song_pipeline_runs', { __reject: dup }],
    ]);
    const res = makeRes();
    await pipelineHandler(
      { method: 'POST', query: { id: 's1' }, body: { filename: 'sion.mp3' } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('un run previo failed se marca superseded y NO da 409 (se crea el nuevo)', async () => {
    let supersededCall;
    routeSql([
      ['SELECT id, title FROM songs', [{ id: 's1', title: 'Sion' }]],
      [
        "UPDATE song_pipeline_runs SET status = 'superseded'",
        (values) => {
          supersededCall = values;
          return [];
        },
      ],
      ['INSERT INTO song_pipeline_runs', [{ id: 'r2' }]],
      ['UPDATE song_pipeline_runs SET input_path', []],
    ]);
    const res = makeRes();
    await pipelineHandler(
      { method: 'POST', query: { id: 's1' }, body: { filename: 'sion.mp3' } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].runId).toBe('r2');
    expect(supersededCall).toBeDefined();
  });

  it('crea el run en created con titleScore + responde runId/uploadUrl/titleScore/threshold', async () => {
    routeSql([
      ['SELECT id, title FROM songs', [{ id: 's1', title: 'Sion' }]],
      ["UPDATE song_pipeline_runs SET status = 'superseded'", []],
      ['INSERT INTO song_pipeline_runs', [{ id: 'r1' }]],
      ['UPDATE song_pipeline_runs SET input_path', []],
    ]);
    const res = makeRes();
    await pipelineHandler(
      {
        method: 'POST',
        query: { id: 's1' },
        body: { filename: 'sion.mp3', size: 10, mime: 'audio/mpeg' },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.runId).toBe('r1');
    expect(body.uploadUrl).toBe('https://signed/put/s1/runs/r1/full.mp3');
    expect(body.titleScore).toBeGreaterThan(0.6);
    expect(body.threshold).toBe(0.6);
    expect(body.songTitle).toBe('Sion');
    expect(createSongAudioSignedPutUrl).toHaveBeenCalledWith('s1/runs/r1/full.mp3');
  });

  it('titleScore bajo NO bloquea la creación (queda en input_meta, sin override explícito)', async () => {
    let insertedMeta;
    routeSql([
      ['SELECT id, title FROM songs', [{ id: 's1', title: 'Sion' }]],
      [
        'INSERT INTO song_pipeline_runs',
        (values) => {
          insertedMeta = values.find((v) => v && typeof v === 'object' && 'titleScore' in v);
          return [{ id: 'r1' }];
        },
      ],
      ['UPDATE song_pipeline_runs SET input_path', []],
    ]);
    const res = makeRes();
    await pipelineHandler(
      {
        method: 'POST',
        query: { id: 's1' },
        body: { filename: 'archivo-totalmente-distinto.mp3' },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.titleScore).toBeLessThan(0.6);
    expect(insertedMeta.titleScore).toBe(body.titleScore);
  });
});

describe('GET /api/songs/:id/pipeline', () => {
  it('devuelve el run activo con phases + urls firmadas de tracks', async () => {
    const phases = initialPhases();
    phases.stems = {
      status: 'done',
      error: null,
      tracks: { lead: 's1/stems/lead.mp3' },
      artifacts: undefined,
    };
    routeSql([
      [
        'SELECT id, song_id AS "songId"',
        [{ id: 'r1', songId: 's1', status: 'processing', phases, inputMeta: {}, lyricsReview: {} }],
      ],
    ]);
    const res = makeRes();
    await pipelineHandler({ method: 'GET', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.run.phases.stems.tracks.lead).toBe('https://signed/get/s1/stems/lead.mp3');
  });

  it('404 si no hay run activo', async () => {
    routeSql([['SELECT id, song_id AS "songId"', []]]);
    const res = makeRes();
    await pipelineHandler({ method: 'GET', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('devuelve un run terminal done (canción ya procesada, no 404)', async () => {
    // Fallback findCurrentRun: sin run activo pero con uno terminal 'done', la
    // vista de Procesamiento debe verlo (6/6), no caer en 404 "no procesada".
    const phases = initialPhases();
    for (const k of Object.keys(phases)) phases[k] = { status: 'done', error: null };
    routeSql([
      [
        'SELECT id, song_id AS "songId"',
        [{ id: 'r-done', songId: 's1', status: 'done', phases, inputMeta: {}, lyricsReview: {} }],
      ],
    ]);
    const res = makeRes();
    await pipelineHandler({ method: 'GET', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].run.status).toBe('done');
  });

  it('adjunta run.structure.segments desde song_structure (Task 16)', async () => {
    const phases = initialPhases();
    const segments = [{ label: 'verso', startMs: 0, endMs: 5000 }];
    routeSql([
      [
        'SELECT id, song_id AS "songId"',
        [{ id: 'r1', songId: 's1', status: 'processing', phases, inputMeta: {}, lyricsReview: {} }],
      ],
      ['SELECT segments FROM song_structure', [{ segments }]],
    ]);
    const res = makeRes();
    await pipelineHandler({ method: 'GET', query: { id: 's1' } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.run.structure).toEqual({ segments });
  });

  it('run.structure es null si todavía no hay song_structure para la canción', async () => {
    const phases = initialPhases();
    routeSql([
      [
        'SELECT id, song_id AS "songId"',
        [{ id: 'r1', songId: 's1', status: 'processing', phases, inputMeta: {}, lyricsReview: {} }],
      ],
      ['SELECT segments FROM song_structure', []],
    ]);
    const res = makeRes();
    await pipelineHandler({ method: 'GET', query: { id: 's1' } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.run.structure).toBeNull();
  });
});

describe('DELETE /api/songs/:id/pipeline (A2: purga)', () => {
  it('purga filas derivadas + storage y marca runs (activo→cancelled, done/failed→superseded)', async () => {
    routeSql([
      [
        'FROM song_stems',
        [{ storageKey: 's1/stems/lead.mp3' }, { storageKey: 's1/stems/backing.mp3' }],
      ],
      ['FROM song_section_audio', [{ storageKey: 's1/clips/0.mp3' }]],
      [
        'SELECT id, status, input_path',
        [
          { id: 'r-done', status: 'done', input_path: 's1/runs/r-done/full.mp3' },
          { id: 'r-act', status: 'awaiting_lyrics', input_path: 's1/runs/r-act/full.mp3' },
          // Run failed con input_path colgado (follow-up del database review):
          // debe superseder-se igual que 'done', si no queda apuntando a un
          // objeto de storage ya borrado.
          { id: 'r-failed', status: 'failed', input_path: 's1/runs/r-failed/full.mp3' },
        ],
      ],
      ['DELETE FROM song_stems', { count: 2 }],
      ['DELETE FROM song_section_audio', { count: 1 }],
      ['DELETE FROM song_structure', { count: 1 }],
      ['DELETE FROM song_pitch_analysis', { count: 1 }],
      ['DELETE FROM song_pipeline_lyrics', { count: 1 }],
      ['DELETE FROM song_line_timings', { count: 1 }],
      ["SET status = 'cancelled'", { count: 1 }],
      ["SET status = 'superseded'", { count: 2 }],
    ]);
    const res = makeRes();
    await pipelineHandler({ method: 'DELETE', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(storage.deleteSongAudioObjects).toHaveBeenCalledWith(
      expect.arrayContaining([
        's1/stems/lead.mp3',
        's1/stems/backing.mp3',
        's1/clips/0.mp3',
        's1/runs/r-done/full.mp3',
        's1/runs/r-act/full.mp3',
        's1/runs/r-failed/full.mp3',
      ]),
    );
    // Fix 1 (review holístico): la purga también borra los artefactos de
    // pitch en el bucket pitch-jobs, run por run (deletePitchPrefix no lista
    // por prefijo parcial de song, solo por prefijo exacto de run).
    expect(deletePitchPrefix).toHaveBeenCalledWith('pipeline/s1/r-done');
    expect(deletePitchPrefix).toHaveBeenCalledWith('pipeline/s1/r-act');
    expect(deletePitchPrefix).toHaveBeenCalledWith('pipeline/s1/r-failed');
    // Contrato: el UPDATE a superseded también cubre 'failed', no solo 'done'.
    const supersedeQuery = capturedQueries.find((q) => q.includes("SET status = 'superseded'"));
    expect(supersedeQuery).toContain('failed');
    // Task 4: la purga borra el store propio de letra IA...
    const pipelineLyricsQuery = capturedQueries.find((q) => q.includes('song_pipeline_lyrics'));
    expect(pipelineLyricsQuery).toContain('DELETE FROM song_pipeline_lyrics');
    // ...y el shim de song_line_timings queda filtrado al provider del
    // pipeline: un align standalone (provider 'whisperx', ver
    // modal/align_app.py) no debe perderse al reemplazar el audio.
    const timingsQuery = capturedQueries.find((q) => q.includes('DELETE FROM song_line_timings'));
    expect(timingsQuery).toContain("provider = 'pipeline'");
  });

  it('NO borra clips manuales (run_id NULL) ni toca songs.sections', async () => {
    routeSql([
      ['FROM song_stems', []],
      ['FROM song_section_audio', []],
      ['SELECT id, status, input_path', []],
      ['DELETE FROM song_stems', { count: 0 }],
      ['DELETE FROM song_section_audio', { count: 0 }],
      ['DELETE FROM song_structure', { count: 0 }],
      ['DELETE FROM song_pitch_analysis', { count: 0 }],
      ['DELETE FROM song_line_timings', { count: 0 }],
      ["SET status = 'cancelled'", { count: 0 }],
      ["SET status = 'superseded'", { count: 0 }],
    ]);
    const res = makeRes();
    await pipelineHandler({ method: 'DELETE', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);

    const sectionAudioQueries = capturedQueries.filter((q) => q.includes('song_section_audio'));
    expect(sectionAudioQueries.length).toBeGreaterThan(0);
    for (const q of sectionAudioQueries) {
      expect(q).toContain('run_id IS NOT NULL');
    }
    for (const q of capturedQueries) {
      expect(q).not.toContain('UPDATE songs');
      expect(q).not.toContain('songs.sections');
    }
  });

  it('idempotente: segunda llamada sin nada que borrar responde 200', async () => {
    routeSql([
      ['FROM song_stems', []],
      ['FROM song_section_audio', []],
      ['SELECT id, status, input_path', []],
      ['DELETE FROM song_stems', { count: 0 }],
      ['DELETE FROM song_section_audio', { count: 0 }],
      ['DELETE FROM song_structure', { count: 0 }],
      ['DELETE FROM song_pitch_analysis', { count: 0 }],
      ['DELETE FROM song_line_timings', { count: 0 }],
      ["SET status = 'cancelled'", { count: 0 }],
      ["SET status = 'superseded'", { count: 0 }],
    ]);
    const res = makeRes();
    await pipelineHandler({ method: 'DELETE', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });
});

describe('POST /api/songs/:id/pipeline/confirm', () => {
  it('404 si no hay run pendiente de confirmar', async () => {
    routeSql([['SELECT id, song_id AS "songId"', []]]);
    const res = makeRes();
    await confirmHandler({ method: 'POST', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('422 si el objeto no existe en storage', async () => {
    pipelineInputStat.mockResolvedValueOnce({ exists: false, size: null });
    routeSql([
      [
        'SELECT id, song_id AS "songId"',
        [
          {
            id: 'r1',
            songId: 's1',
            status: 'created',
            phases: initialPhases(),
            inputPath: 's1/runs/r1/full.mp3',
          },
        ],
      ],
    ]);
    const res = makeRes();
    await confirmHandler({ method: 'POST', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('422 si el objeto excede el límite de 25MB', async () => {
    pipelineInputStat.mockResolvedValueOnce({ exists: true, size: 26214401 });
    routeSql([
      [
        'SELECT id, song_id AS "songId"',
        [
          {
            id: 'r1',
            songId: 's1',
            status: 'created',
            phases: initialPhases(),
            inputPath: 's1/runs/r1/full.mp3',
          },
        ],
      ],
    ]);
    const res = makeRes();
    await confirmHandler({ method: 'POST', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('feliz: marca upload done, status=processing y despacha stems', async () => {
    let updatedRow;
    routeSql([
      [
        'SELECT id, song_id AS "songId"',
        [
          {
            id: 'r1',
            songId: 's1',
            status: 'created',
            phases: initialPhases(),
            inputPath: 's1/runs/r1/full.mp3',
          },
        ],
      ],
      [
        "UPDATE song_pipeline_runs SET status = 'processing'",
        (values) => {
          updatedRow = values;
          return { count: 1 };
        },
      ],
    ]);
    const res = makeRes();
    await confirmHandler({ method: 'POST', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(dispatchPhase).toHaveBeenCalledWith('stems', expect.objectContaining({ id: 'r1' }));
    const persistedPhases = updatedRow.find((v) => v && v.upload);
    expect(persistedPhases.upload.status).toBe('done');
  });

  it('feliz con durationSec válida: mergea input_meta en el UPDATE a processing', async () => {
    let updatedRow;
    routeSql([
      [
        'SELECT id, song_id AS "songId"',
        [
          {
            id: 'r1',
            songId: 's1',
            status: 'created',
            phases: initialPhases(),
            inputPath: 's1/runs/r1/full.mp3',
          },
        ],
      ],
      [
        "UPDATE song_pipeline_runs SET status = 'processing'",
        (values) => {
          updatedRow = values;
          return { count: 1 };
        },
      ],
    ]);
    const res = makeRes();
    await confirmHandler(
      { method: 'POST', query: { id: 's1' }, body: { durationSec: 187.5 } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const mergedMeta = updatedRow.find((v) => v && typeof v === 'object' && 'durationSec' in v);
    expect(mergedMeta.durationSec).toBe(187.5);
  });

  it('durationSec inválida (negativa) no rompe el confirm y no toca input_meta', async () => {
    let updatedRow;
    routeSql([
      [
        'SELECT id, song_id AS "songId"',
        [
          {
            id: 'r1',
            songId: 's1',
            status: 'created',
            phases: initialPhases(),
            inputPath: 's1/runs/r1/full.mp3',
          },
        ],
      ],
      [
        "UPDATE song_pipeline_runs SET status = 'processing'",
        (values) => {
          updatedRow = values;
          return { count: 1 };
        },
      ],
    ]);
    const res = makeRes();
    await confirmHandler({ method: 'POST', query: { id: 's1' }, body: { durationSec: -5 } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const mergedMeta = updatedRow.find((v) => v && typeof v === 'object' && 'durationSec' in v);
    expect(mergedMeta).toBeUndefined();
  });

  it('sin durationSec en el body: no rompe el confirm y no toca input_meta', async () => {
    let updatedRow;
    routeSql([
      [
        'SELECT id, song_id AS "songId"',
        [
          {
            id: 'r1',
            songId: 's1',
            status: 'created',
            phases: initialPhases(),
            inputPath: 's1/runs/r1/full.mp3',
          },
        ],
      ],
      [
        "UPDATE song_pipeline_runs SET status = 'processing'",
        (values) => {
          updatedRow = values;
          return { count: 1 };
        },
      ],
    ]);
    const res = makeRes();
    await confirmHandler({ method: 'POST', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const mergedMeta = updatedRow.find((v) => v && typeof v === 'object' && 'durationSec' in v);
    expect(mergedMeta).toBeUndefined();
  });

  it('409 si el CAS pierde la carrera (ya confirmado)', async () => {
    routeSql([
      [
        'SELECT id, song_id AS "songId"',
        [
          {
            id: 'r1',
            songId: 's1',
            status: 'created',
            phases: initialPhases(),
            inputPath: 's1/runs/r1/full.mp3',
          },
        ],
      ],
      ["UPDATE song_pipeline_runs SET status = 'processing'", { count: 0 }],
    ]);
    const res = makeRes();
    await confirmHandler({ method: 'POST', query: { id: 's1' } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(dispatchPhase).not.toHaveBeenCalled();
  });

  it('dispatch falla 2 veces: solo la fase stems queda failed, run sigue processing (502)', async () => {
    dispatchPhase.mockRejectedValue(new Error('modal down'));
    let finalPhases;
    routeSql([
      [
        'SELECT id, song_id AS "songId"',
        [
          {
            id: 'r1',
            songId: 's1',
            status: 'created',
            phases: initialPhases(),
            inputPath: 's1/runs/r1/full.mp3',
          },
        ],
      ],
      ["UPDATE song_pipeline_runs SET status = 'processing'", { count: 1 }],
      [
        'UPDATE song_pipeline_runs SET phases = ',
        (values) => {
          finalPhases = values.find((v) => v && v.stems);
          return { count: 1 };
        },
      ],
    ]);
    const res = makeRes();
    await confirmHandler({ method: 'POST', query: { id: 's1' } }, res);
    expect(dispatchPhase).toHaveBeenCalledTimes(2);
    expect(finalPhases.stems.status).toBe('failed');
    expect(res.status).toHaveBeenCalledWith(502);
  });
});

describe('POST /api/songs/:id/pipeline/retry', () => {
  function activePhasesWithStemsFailed() {
    const phases = initialPhases();
    phases.upload.status = 'done';
    phases.stems = { status: 'failed', error: 'boom', tracks: undefined, artifacts: undefined };
    return phases;
  }

  it('400 si la fase no admite reintento', async () => {
    const res = makeRes();
    await retryHandler({ method: 'POST', query: { id: 's1' }, body: { phase: 'upload' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('404 si no hay run activo', async () => {
    routeSql([
      ["status IN ('created', 'uploading', 'processing', 'awaiting_lyrics', 'running')", []],
    ]);
    const res = makeRes();
    await retryHandler({ method: 'POST', query: { id: 's1' }, body: { phase: 'stems' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('409 si la fase no está failed/stale', async () => {
    const phases = initialPhases();
    phases.upload.status = 'done';
    phases.stems = { status: 'running', error: null, tracks: undefined, artifacts: undefined };
    routeSql([
      [
        "status IN ('created', 'uploading', 'processing', 'awaiting_lyrics', 'running')",
        [{ id: 'r1', songId: 's1', status: 'processing', phases, inputPath: 'p' }],
      ],
    ]);
    const res = makeRes();
    await retryHandler({ method: 'POST', query: { id: 's1' }, body: { phase: 'stems' } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(dispatchPhase).not.toHaveBeenCalled();
  });

  it('409 si las dependencias del DAG no están listas', async () => {
    const phases = initialPhases(); // upload sigue 'running', stems no puede arrancar
    phases.stems = { status: 'failed', error: 'boom', tracks: undefined, artifacts: undefined };
    routeSql([
      [
        "status IN ('created', 'uploading', 'processing', 'awaiting_lyrics', 'running')",
        [{ id: 'r1', songId: 's1', status: 'processing', phases, inputPath: 'p' }],
      ],
    ]);
    const res = makeRes();
    await retryHandler({ method: 'POST', query: { id: 's1' }, body: { phase: 'stems' } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(dispatchPhase).not.toHaveBeenCalled();
  });

  it('feliz: resetea a pending/running y re-despacha', async () => {
    let persisted;
    routeSql([
      [
        "status IN ('created', 'uploading', 'processing', 'awaiting_lyrics', 'running')",
        [
          {
            id: 'r1',
            songId: 's1',
            status: 'processing',
            phases: activePhasesWithStemsFailed(),
            inputPath: 'p',
          },
        ],
      ],
      [
        'UPDATE song_pipeline_runs SET phases = ',
        (values) => {
          persisted = values.find((v) => v && v.stems);
          return { count: 1 };
        },
      ],
    ]);
    const res = makeRes();
    await retryHandler({ method: 'POST', query: { id: 's1' }, body: { phase: 'stems' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(dispatchPhase).toHaveBeenCalledWith('stems', expect.objectContaining({ id: 'r1' }), {
      isRetry: true,
    });
    expect(persisted.stems.status).toBe('running');
  });

  it('dispatch falla: la fase vuelve a failed (run retry-able), 502', async () => {
    dispatchPhase.mockRejectedValue(new Error('modal down'));
    const runningPhases = activePhasesWithStemsFailed();
    runningPhases.stems.status = 'running';
    let finalPhases;
    let call = 0;
    routeSql([
      [
        "status IN ('created', 'uploading', 'processing', 'awaiting_lyrics', 'running')",
        [
          {
            id: 'r1',
            songId: 's1',
            status: 'processing',
            phases: activePhasesWithStemsFailed(),
            inputPath: 'p',
          },
        ],
      ],
      // re-lectura FOR UPDATE dentro de la tx del handler de fallo de dispatch.
      ['SELECT phases FROM song_pipeline_runs WHERE id = ', [{ phases: runningPhases }]],
      [
        'UPDATE song_pipeline_runs SET phases = ',
        (values) => {
          call += 1;
          if (call === 2) finalPhases = values.find((v) => v && v.stems);
          return { count: 1 };
        },
      ],
    ]);
    const res = makeRes();
    await retryHandler({ method: 'POST', query: { id: 's1' }, body: { phase: 'stems' } }, res);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(finalPhases.stems.status).toBe('failed');
  });

  it('dispatch falla agotando reintentos: el run deriva a failed (fase critica)', async () => {
    dispatchPhase.mockRejectedValue(new Error('modal down'));
    const claimedPhases = activePhasesWithStemsFailed();
    claimedPhases.stems.retries = 2; // este es el 3er intento -> queda agotado
    const runningPhases = structuredClone(claimedPhases);
    runningPhases.stems.status = 'running';
    runningPhases.stems.retries = 3;
    let finalPhases;
    let finalStatus;
    let call = 0;
    routeSql([
      [
        "status IN ('created', 'uploading', 'processing', 'awaiting_lyrics', 'running')",
        [{ id: 'r1', songId: 's1', status: 'processing', phases: claimedPhases, inputPath: 'p' }],
      ],
      ['SELECT phases FROM song_pipeline_runs WHERE id = ', [{ phases: runningPhases }]],
      [
        'UPDATE song_pipeline_runs SET phases = ',
        (values) => {
          call += 1;
          if (call === 2) {
            finalPhases = values.find((v) => v && v.stems);
            finalStatus = values.find((v) => v === 'failed');
          }
          return { count: 1 };
        },
      ],
    ]);
    const res = makeRes();
    await retryHandler({ method: 'POST', query: { id: 's1' }, body: { phase: 'stems' } }, res);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(finalPhases.stems.status).toBe('failed');
    expect(finalPhases.stems.retries).toBe(3);
    expect(finalStatus).toBe('failed');
  });

  it('409 si al reintentar la fase ya no está failed/stale (otra sesión ya la retomó)', async () => {
    const phases = initialPhases();
    phases.upload.status = 'done';
    phases.stems = { status: 'done', error: null, tracks: { vocals: 'k1' }, artifacts: undefined };
    routeSql([
      [
        "status IN ('created', 'uploading', 'processing', 'awaiting_lyrics', 'running')",
        [{ id: 'r1', songId: 's1', status: 'processing', phases, inputPath: 'p' }],
      ],
    ]);
    const res = makeRes();
    await retryHandler({ method: 'POST', query: { id: 's1' }, body: { phase: 'stems' } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(dispatchPhase).not.toHaveBeenCalled();
  });

  it('permite 3 reintentos (incrementa retries dentro de la tx) y el 4to responde 409 "Reintentos agotados"', async () => {
    for (let i = 0; i < 3; i += 1) {
      const phases = activePhasesWithStemsFailed();
      phases.stems.retries = i;
      let persisted;
      routeSql([
        [
          "status IN ('created', 'uploading', 'processing', 'awaiting_lyrics', 'running')",
          [{ id: 'r1', songId: 's1', status: 'processing', phases, inputPath: 'p' }],
        ],
        [
          'UPDATE song_pipeline_runs SET phases = ',
          (values) => {
            persisted = values.find((v) => v && v.stems);
            return { count: 1 };
          },
        ],
      ]);
      const res = makeRes();
      await retryHandler({ method: 'POST', query: { id: 's1' }, body: { phase: 'stems' } }, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(persisted.stems.retries).toBe(i + 1);
    }

    const exhaustedPhases = activePhasesWithStemsFailed();
    exhaustedPhases.stems.retries = 3;
    routeSql([
      [
        "status IN ('created', 'uploading', 'processing', 'awaiting_lyrics', 'running')",
        [{ id: 'r1', songId: 's1', status: 'processing', phases: exhaustedPhases, inputPath: 'p' }],
      ],
    ]);
    const dispatchCallsBefore = dispatchPhase.mock.calls.length;
    const res = makeRes();
    await retryHandler({ method: 'POST', query: { id: 's1' }, body: { phase: 'stems' } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'Reintentos agotados' });
    expect(dispatchPhase.mock.calls.length).toBe(dispatchCallsBefore);
  });
});

describe('PATCH /api/songs/:id/pipeline (renombrar audio)', () => {
  it('403 si no es admin', async () => {
    requireAdmin.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    const res = makeRes();
    await pipelineHandler(
      { method: 'PATCH', query: { id: 's1' }, body: { displayName: 'Voz principal' } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('400 si displayName está vacío', async () => {
    const res = makeRes();
    await pipelineHandler(
      { method: 'PATCH', query: { id: 's1' }, body: { displayName: '   ' } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('400 si displayName no es string', async () => {
    const res = makeRes();
    await pipelineHandler({ method: 'PATCH', query: { id: 's1' }, body: { displayName: 42 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('404 si la canción no existe', async () => {
    routeSql([['SELECT title FROM songs', []]]);
    const res = makeRes();
    await pipelineHandler(
      { method: 'PATCH', query: { id: 's1' }, body: { displayName: 'Voz principal' } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('mergea input_meta.displayName + recompute titleScore sin pisar filename/size/mime', async () => {
    let mergedValue;
    routeSql([
      ['SELECT title FROM songs', [{ title: 'Voz principal' }]],
      [
        'UPDATE song_pipeline_runs',
        (values) => {
          mergedValue = values.find((v) => v && typeof v === 'object' && 'displayName' in v);
          return { count: 1 };
        },
      ],
    ]);
    const res = makeRes();
    await pipelineHandler(
      { method: 'PATCH', query: { id: 's1' }, body: { displayName: 'Voz principal' } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.songTitle).toBe('Voz principal');
    expect(body.titleScore).toBeGreaterThan(0.6);
    expect(body.threshold).toBe(0.6);
    // El merge se hace con `||` sobre input_meta existente en el SQL (no pisa
    // filename/size/mime): el valor pasado al placeholder trae displayName + titleScore.
    expect(mergedValue).toEqual({ displayName: 'Voz principal', titleScore: body.titleScore });
  });

  it('404 si no hay una ejecución activa (UPDATE afecta 0 filas)', async () => {
    routeSql([
      ['SELECT title FROM songs', [{ title: 'Voz principal' }]],
      ['UPDATE song_pipeline_runs', { count: 0 }],
    ]);
    const res = makeRes();
    await pipelineHandler(
      { method: 'PATCH', query: { id: 's1' }, body: { displayName: 'Voz principal' } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
