// pipelineAdvance.test.js — TDD del módulo compartido advanceNextPhase/
// ADVANCE_AFTER (api/_lib/pipeline/advance.js), extraído de
// api/pipeline/webhook.js para que api/align/webhook.js lo reuse (fase sync).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlResponses = [];
const sqlCalls = [];
function makeInnerSql() {
  const inner = (strings, ...values) => {
    if (!strings?.raw) return strings;
    sqlCalls.push({ text: strings.join('?').replace(/\s+/g, ' ').trim(), values });
    return Promise.resolve(sqlResponses.shift() ?? []);
  };
  inner.json = (v) => v;
  return inner;
}
const sqlMock = makeInnerSql();
sqlMock.begin = async (cb) => cb(makeInnerSql());

const dispatchPhaseMock = vi.fn().mockResolvedValue({ id: 'call-1' });
vi.mock('../api/songs/[id]/pipeline/_dispatch.js', () => ({
  dispatchPhase: (...args) => dispatchPhaseMock(...args),
}));

const { advanceNextPhase, ADVANCE_AFTER } = await import('../api/_lib/pipeline/advance.js');
const { initialPhases } = await import('../api/_lib/pipeline/state.js');

beforeEach(() => {
  sqlResponses.length = 0;
  sqlCalls.length = 0;
  dispatchPhaseMock.mockClear();
});

describe('ADVANCE_AFTER', () => {
  it('define las transiciones automaticas stems->transcription y sync->clips', () => {
    expect(ADVANCE_AFTER).toEqual({ stems: 'transcription', sync: 'clips' });
  });
});

describe('advanceNextPhase', () => {
  it('claim exitoso: marca la fase running y dispara dispatchPhase', async () => {
    const phases = initialPhases();
    phases.sync = { status: 'done' };
    sqlResponses.push([{ phases }]); // SELECT phases FOR UPDATE (claim)
    sqlResponses.push([]); // UPDATE phases (marca clips 'running')

    await advanceNextPhase(sqlMock, 'run-1', 'song-1', 'clips');

    expect(dispatchPhaseMock).toHaveBeenCalledWith('clips', expect.objectContaining({ id: 'run-1', songId: 'song-1' }));
    const update = sqlCalls.find((c) => c.text.includes('UPDATE song_pipeline_runs'));
    expect(update).toBeDefined();
  });

  it('canStartPhase false (dependencia no cumplida) → no dispara dispatch', async () => {
    const phases = initialPhases(); // sync sigue 'pending', clips no puede arrancar
    sqlResponses.push([{ phases }]); // SELECT phases FOR UPDATE (claim)

    await advanceNextPhase(sqlMock, 'run-1', 'song-1', 'clips');

    expect(dispatchPhaseMock).not.toHaveBeenCalled();
    expect(sqlCalls.some((c) => c.text.includes('UPDATE song_pipeline_runs'))).toBe(false);
  });

  it('dispatchPhase falla → marca la fase failed en una segunda tx', async () => {
    const phases = initialPhases();
    phases.sync = { status: 'done' };
    sqlResponses.push([{ phases }]); // SELECT phases FOR UPDATE (claim)
    sqlResponses.push([]); // UPDATE phases (marca clips 'running')
    const claimedPhases = structuredClone(phases);
    claimedPhases.clips = { status: 'running' };
    sqlResponses.push([{ phases: claimedPhases }]); // SELECT phases FOR UPDATE (tx de error)
    sqlResponses.push([]); // UPDATE phases (marca clips 'failed')
    dispatchPhaseMock.mockRejectedValueOnce(new Error('Modal caido'));

    await advanceNextPhase(sqlMock, 'run-1', 'song-1', 'clips');

    const failUpdate = sqlCalls.filter((c) => c.text.includes('UPDATE song_pipeline_runs'));
    expect(failUpdate.length).toBe(2);
    const failedArg = failUpdate[1].values.find((v) => v && typeof v === 'object' && v.clips);
    expect(failedArg.clips.status).toBe('failed');
    expect(failedArg.clips.error).toContain('Modal caido');
  });

  it('dispatchPhase falla por timeout → el mensaje avisa que Modal pudo haber arrancado igual', async () => {
    const phases = initialPhases();
    phases.sync = { status: 'done' };
    sqlResponses.push([{ phases }]); // SELECT phases FOR UPDATE (claim)
    sqlResponses.push([]); // UPDATE phases (marca clips 'running')
    const claimedPhases = structuredClone(phases);
    claimedPhases.clips = { status: 'running' };
    sqlResponses.push([{ phases: claimedPhases }]); // SELECT phases FOR UPDATE (tx de error)
    sqlResponses.push([]); // UPDATE phases (marca clips 'failed')
    dispatchPhaseMock.mockRejectedValueOnce(
      Object.assign(new Error('Modal no respondió a tiempo.'), { timeout: true }),
    );

    await advanceNextPhase(sqlMock, 'run-1', 'song-1', 'clips');

    const failUpdate = sqlCalls.filter((c) => c.text.includes('UPDATE song_pipeline_runs'));
    const failedArg = failUpdate[1].values.find((v) => v && typeof v === 'object' && v.clips);
    expect(failedArg.clips.status).toBe('failed');
    expect(failedArg.clips.error).toContain('pudo haber arrancado en Modal igual');
    expect(failedArg.clips.error.length).toBeLessThanOrEqual(300);
  });

  it('dispatchPhase falla → preserva retries de la fase (tope de reintentos manuales no se regala)', async () => {
    const phases = initialPhases();
    phases.sync = { status: 'done' };
    sqlResponses.push([{ phases }]); // SELECT phases FOR UPDATE (claim)
    sqlResponses.push([]); // UPDATE phases (marca clips 'running')
    const claimedPhases = structuredClone(phases);
    claimedPhases.clips = { status: 'running', retries: 2 }; // ya se agotaron 2 de 3 retries manuales
    sqlResponses.push([{ phases: claimedPhases }]); // SELECT phases FOR UPDATE (tx de error)
    sqlResponses.push([]); // UPDATE phases (marca clips 'failed')
    dispatchPhaseMock.mockRejectedValueOnce(new Error('Modal caido'));

    await advanceNextPhase(sqlMock, 'run-1', 'song-1', 'clips');

    const failUpdate = sqlCalls.filter((c) => c.text.includes('UPDATE song_pipeline_runs'));
    const failedArg = failUpdate[1].values.find((v) => v && typeof v === 'object' && v.clips);
    expect(failedArg.clips.status).toBe('failed');
    expect(failedArg.clips.retries).toBe(2);
  });

  it('fix HIGH 1: dispatchPhase falla → preserva tracks ya publicados por la fase (no deja el run irrecuperable)', async () => {
    const phases = initialPhases();
    phases.upload = { status: 'done' };
    phases.stems = { status: 'done', tracks: { vocals: 'k-vocals' } };
    sqlResponses.push([{ phases }]); // SELECT phases FOR UPDATE (claim)
    sqlResponses.push([]); // UPDATE phases (marca transcription 'running')
    const claimedPhases = structuredClone(phases);
    claimedPhases.transcription = { status: 'running', tracks: { partial: 'x' } };
    sqlResponses.push([{ phases: claimedPhases }]); // SELECT phases FOR UPDATE (tx de error)
    sqlResponses.push([]); // UPDATE phases (marca transcription 'failed')
    dispatchPhaseMock.mockRejectedValueOnce(new Error('Modal caido'));

    await advanceNextPhase(sqlMock, 'run-1', 'song-1', 'transcription');

    const failUpdate = sqlCalls.filter((c) => c.text.includes('UPDATE song_pipeline_runs'));
    const failedArg = failUpdate[1].values.find((v) => v && typeof v === 'object' && v.transcription);
    expect(failedArg.transcription.status).toBe('failed');
    // DEPS.pitch (state.js) mira el track, no el status: un UPDATE ciego que
    // solo escriba {status,error,retries} lo borra y canStartPhase queda en
    // false para siempre.
    expect(failedArg.transcription.tracks).toEqual({ partial: 'x' });
  });

  it('fix MEDIUM: dispatchPhase falla y agota reintentos → el run deriva a status failed (no queda processing eterno)', async () => {
    const phases = initialPhases();
    phases.sync = { status: 'done' };
    sqlResponses.push([{ phases }]); // SELECT phases FOR UPDATE (claim)
    sqlResponses.push([]); // UPDATE phases (marca clips 'running')
    const claimedPhases = structuredClone(phases);
    claimedPhases.clips = { status: 'running', retries: 3 }; // ya agotó los 3 reintentos
    sqlResponses.push([{ phases: claimedPhases }]); // SELECT phases FOR UPDATE (tx de error)
    sqlResponses.push([]); // UPDATE phases (marca clips 'failed' + status del run)
    dispatchPhaseMock.mockRejectedValueOnce(new Error('Modal caido'));

    await advanceNextPhase(sqlMock, 'run-1', 'song-1', 'clips');

    const failUpdate = sqlCalls.filter((c) => c.text.includes('UPDATE song_pipeline_runs'));
    expect(failUpdate[1].text).toContain('status =');
    expect(failUpdate[1].values).toContain('failed');
  });
});
