import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initSections } from '../api/stems/_sections.js';

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
const { processPredictionResult, applySectionWebhook } = await import('../api/stems/_process.js');

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

// ─── applySectionWebhook: per-section DAG ────────────────────────────────────

/**
 * Fake sql con soporte para `sql.begin(callback)` (transacciones).
 * El callback recibe un sql interno que hace SELECT ... FOR UPDATE y UPDATE.
 * La cola `rows` se consume en orden; la mutación refleja applySectionResult.
 */
function makeSqlWithBegin({ sections, status = 'processing' } = {}) {
  const state = { sections, status };
  const calls = [];

  function innerSql(strings, ...values) {
    if (!strings?.raw) return strings;
    const text = strings.join(' ? ').replace(/\s+/g, ' ').trim();
    calls.push({ text, values });

    // SELECT ... FOR UPDATE → devuelve el job actual
    if (text.includes('FOR UPDATE')) {
      if (state.sections === null) return Promise.resolve([]); // job desconocido
      return Promise.resolve([{ sections: state.sections, status: state.status }]);
    }
    // UPDATE stem_jobs SET sections = ... — captura el nuevo estado
    if (text.includes('SET sections =')) {
      const nextSections = values.find((v) => v && typeof v === 'object' && !Array.isArray(v) && !('status' in v));
      const nextStatus = values.find((v) => typeof v === 'string' && ['processing', 'done', 'failed', 'partial'].includes(v));
      if (nextSections) state.sections = nextSections;
      if (nextStatus) state.status = nextStatus;
    }
    return Promise.resolve([]);
  }
  innerSql.json = (v) => v;

  function sql(strings, ...values) {
    return innerSql(strings, ...values);
  }
  sql.begin = async (cb) => cb(innerSql);
  sql.json = (v) => v;
  sql.calls = calls;
  sql.state = state;
  return sql;
}

describe('applySectionWebhook — por sección DAG', () => {
  it('done en `structure` (con segments) aplica y deja el job en processing si otras secciones siguen', async () => {
    const sections = initSections(['voiceInstrumental', 'structure', 'leadBacking']);
    const sql = makeSqlWithBegin({ sections });

    const result = await applySectionWebhook(sql, 'job-1', 'structure', {
      status: 'done',
      model: 'allin1',
      segments: [{ start: 0, end: 4, label: 'verse' }],
    });

    expect(result).not.toBeNull();
    expect(result.status).toBe('processing'); // voiceInstrumental y leadBacking siguen pending
    expect(sql.state.sections.structure.status).toBe('done');
    expect(sql.state.sections.structure.segments).toHaveLength(1);
    // nota: el FOR UPDATE serializa lecturas concurrentes a nivel de DB;
    // el test unitario no puede reproducir concurrencia real, pero la transacción está en su lugar.
  });

  it('failed en una sección con otra done → status partial', async () => {
    const sections = initSections(['voiceInstrumental', 'structure', 'leadBacking']);
    // Marcar structure como done manualmente para partir de ese estado
    sections.structure.status = 'done';
    sections.structure.segments = [];
    sections.leadBacking.status = 'skipped'; // simular skip para simplificar

    const sql = makeSqlWithBegin({ sections });

    // voiceInstrumental falla
    const result = await applySectionWebhook(sql, 'job-1', 'voiceInstrumental', {
      status: 'failed',
      model: 'htdemucs',
      error: 'OOM',
    });

    expect(result.status).toBe('partial'); // structure done, voiceInstrumental failed, leadBacking skipped
    expect(sql.state.sections.voiceInstrumental.status).toBe('failed');
  });

  it('idempotencia: aplicar el mismo webhook done dos veces produce el mismo resultado', async () => {
    const sections = initSections(['voiceInstrumental', 'structure']);
    const sql = makeSqlWithBegin({ sections });

    const r1 = await applySectionWebhook(sql, 'job-1', 'structure', {
      status: 'done',
      model: 'allin1',
      segments: [{ start: 0, end: 2, label: 'intro' }],
    });

    // Segunda aplicación del mismo webhook (re-entrega)
    const r2 = await applySectionWebhook(sql, 'job-1', 'structure', {
      status: 'done',
      model: 'allin1',
      segments: [{ start: 0, end: 2, label: 'intro' }],
    });

    expect(r1.sections.structure.status).toBe('done');
    expect(r2.sections.structure.status).toBe('done');
    // El estado no se corrompe
    expect(JSON.stringify(r1.sections.structure)).toBe(JSON.stringify(r2.sections.structure));
  });

  it('job desconocido → devuelve null', async () => {
    const sql = makeSqlWithBegin({ sections: null }); // job no existe en DB
    const result = await applySectionWebhook(sql, 'no-existe', 'structure', { status: 'done' });
    expect(result).toBeNull();
  });

  it('sección desconocida → lanza error con status 400', async () => {
    const sections = initSections(['structure']);
    const sql = makeSqlWithBegin({ sections });
    await expect(
      applySectionWebhook(sql, 'job-1', 'seccionInvalida', { status: 'done' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
