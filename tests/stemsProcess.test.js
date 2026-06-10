import { describe, it, expect, vi, beforeEach } from 'vitest';

// _provider.js maneja "quién arranca" y "output → keys". Lo mockeamos para controlar
// éxito/fallo de cada dispatch sin tocar red. providerFor → replicate (irrelevante aquí).
vi.mock('../api/stems/_provider.js', () => ({
  startModel: vi.fn(),
  providerFor: () => 'replicate',
  ingestResult: vi.fn(),
}));
vi.mock('../api/_lib/storage.js', () => ({
  signStemsDownload: vi.fn(async () => 'https://signed/vocal'),
}));

process.env.PUBLIC_BASE_URL = 'https://hgmlyrics.vercel.app';

const { startModel, ingestResult } = await import('../api/stems/_provider.js');
const { processPredictionResult } = await import('../api/stems/_process.js');

/**
 * Fake de `sql` con estado: evita la fragilidad de una cola de respuestas plana cuando
 * los dos dispatches de etapa 2 corren concurrentes en Promise.all. Mantiene el estado
 * del job (status/voices/stems/predictions) y lo muta según el UPDATE que llega,
 * replicando la semántica real (merge jsonb, guards de WHERE, transición a done).
 */
function makeSql({ status = 'separating_stems', voices = null, predictions = {} } = {}) {
  const state = { status, voices, predictions, stems: null };
  const calls = [];
  function sql(strings, ...values) {
    if (!strings?.raw) return strings; // sql(array) passthrough (IN lists)
    const text = strings.join(' ? ').replace(/\s+/g, ' ').trim();
    calls.push({ text, values });
    const objVal = (pred) => values.find((v) => v && typeof v === 'object' && pred(v));

    if (text.includes('voices = COALESCE')) {
      if (state.status !== 'separating_voices') return Promise.resolve([]); // WHERE guard
      const patch = objVal((v) => 'lead' in v || 'backing' in v || 'segments' in v);
      state.voices = { ...(state.voices ?? {}), ...patch };
      return Promise.resolve([{ voices: state.voices }]);
    }
    if (text.includes("status = 'done'")) {
      if (state.status === 'separating_voices') state.status = 'done';
      return Promise.resolve([]);
    }
    if (text.includes('stems =') && text.includes("status = 'separating_voices'")) {
      if (state.status === 'separating_stems') {
        state.status = 'separating_voices';
        state.stems = objVal((v) => 'vocals' in v);
      }
      return Promise.resolve([]);
    }
    if (text.includes('predictions = predictions ||')) {
      Object.assign(
        state.predictions,
        objVal(() => true),
      );
      return Promise.resolve([]);
    }
    if (text.includes("status = 'failed'")) {
      state.status = 'failed';
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  }
  sql.json = (v) => v;
  sql.calls = calls;
  sql.state = state;
  return sql;
}

const STEMS = {
  vocals: 'u1/j1/stems/vocals.mp3',
  drums: 'd',
  bass: 'b',
  guitar: 'g',
  piano: 'p',
  other: 'o',
};
const stemsJob = () => ({ id: 'j1', user_id: 'u1', status: 'separating_stems', voices: null });
const succeeded = { status: 'succeeded', output: {} };

beforeEach(() => {
  startModel.mockReset();
  ingestResult.mockReset().mockResolvedValue(STEMS);
});

describe('processPredictionResult — etapa 1 (stems) → despacho etapa 2', () => {
  it('persiste los stems ANTES de despachar la etapa 2', async () => {
    startModel.mockImplementation(async ({ kind }) => ({ id: `pred_${kind}` }));
    const sql = makeSql();
    await processPredictionResult(sql, stemsJob(), 'stems', succeeded, 'replicate');

    expect(sql.state.stems).toBeTruthy();
    expect(sql.state.status).toBe('separating_voices');
    expect(sql.state.predictions).toEqual({
      karaoke: 'pred_karaoke',
      diarization: 'pred_diarization',
    });

    const stemsIdx = sql.calls.findIndex((c) => c.text.includes('stems ='));
    const predIdx = sql.calls.findIndex((c) => c.text.includes('predictions = predictions ||'));
    expect(stemsIdx).toBeGreaterThanOrEqual(0);
    expect(predIdx).toBeGreaterThan(stemsIdx); // el persist de stems va primero
  });

  it('un dispatch que falla NO descarta los stems ni aborta al otro modelo', async () => {
    // karaoke falla siempre (502); diarización arranca bien
    startModel.mockImplementation(async ({ kind }) => {
      if (kind === 'karaoke') throw Object.assign(new Error('Replicate 502'), { status: 502 });
      return { id: 'pred_diarization' };
    });
    const sql = makeSql();
    await processPredictionResult(sql, stemsJob(), 'stems', succeeded, 'replicate');

    expect(sql.state.stems).toBeTruthy(); // trabajo de GPU preservado
    expect(sql.state.predictions).toEqual({ diarization: 'pred_diarization' });
    expect(sql.state.voices).toEqual({ lead: null, backing: null }); // karaoke degradado
    expect(sql.state.status).toBe('separating_voices'); // sigue esperando segments

    const karaokeAttempts = startModel.mock.calls.filter((c) => c[0].kind === 'karaoke');
    expect(karaokeAttempts).toHaveLength(2); // reintento x1 antes de degradar
  });

  it('si AMBOS dispatch fallan, degrada las dos partes y el job llega a done', async () => {
    startModel.mockRejectedValue(Object.assign(new Error('502'), { status: 502 }));
    const sql = makeSql();
    await processPredictionResult(sql, stemsJob(), 'stems', succeeded, 'replicate');

    expect(sql.state.stems).toBeTruthy();
    expect(sql.state.voices).toEqual({ lead: null, backing: null, segments: [] });
    expect(sql.state.status).toBe('done');
    expect(startModel).toHaveBeenCalledTimes(4); // 2 kinds × 2 intentos
  });

  it('un fallo transitorio se recupera con el reintento, sin degradar', async () => {
    let karaoke = 0;
    startModel.mockImplementation(async ({ kind }) => {
      if (kind === 'karaoke') {
        karaoke += 1;
        if (karaoke === 1) throw new Error('blip transitorio');
        return { id: 'pred_karaoke' };
      }
      return { id: 'pred_diarization' };
    });
    const sql = makeSql();
    await processPredictionResult(sql, stemsJob(), 'stems', succeeded, 'replicate');

    expect(sql.state.predictions).toEqual({
      karaoke: 'pred_karaoke',
      diarization: 'pred_diarization',
    });
    expect(sql.state.voices).toBeNull(); // sin degradación: espera los webhooks
    expect(sql.state.status).toBe('separating_voices');
  });
});
