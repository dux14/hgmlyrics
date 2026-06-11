import { describe, it, expect } from 'vitest';
import { initSections } from '../api/stems/_sections.js';

process.env.PUBLIC_BASE_URL = 'https://hgmlyrics.vercel.app';

const { applySectionWebhook } = await import('../api/stems/_process.js');

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
