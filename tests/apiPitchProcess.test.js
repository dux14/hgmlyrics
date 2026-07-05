import { describe, it, expect, vi } from 'vitest';
import { applyPhaseWebhook, REQUIRED_PHASES } from '../api/pitch/_lib/process.js';

// sql fake: primera lectura devuelve el job; el UPDATE CAS "gana" (rowCount 1).
function makeSql(initialPhases) {
  const phases = initialPhases;
  const sql = vi.fn(async (strings) => {
    const q = strings.join('?');
    if (/SELECT .* FROM pitch_jobs WHERE id/.test(q)) {
      return [{ id: 'j', status: 'running', phases, artifacts: [] }];
    }
    if (/UPDATE pitch_jobs SET phases/.test(q)) {
      return { count: 1 };
    }
    if (/UPDATE pitch_jobs SET status/.test(q)) return { count: 1 };
    return [];
  });
  sql.json = (o) => o;
  return sql;
}

describe('applyPhaseWebhook', () => {
  it('marca la fase como done y no falla', async () => {
    const out = await applyPhaseWebhook(makeSql({}), 'j', 'f0', { ok: true });
    expect(out).not.toBeNull();
    expect(REQUIRED_PHASES).toContain('f0');
  });
  it('devuelve null si el job no existe', async () => {
    const sql = vi.fn(async () => []);
    sql.json = (o) => o;
    const out = await applyPhaseWebhook(sql, 'nope', 'f0', {});
    expect(out).toBeNull();
  });
});

// sql fake con estado mutable real: el UPDATE de `phases` solo "gana" si el
// `WHERE phases = $expected` coincide con el estado actual (CAS real), y el
// UPDATE de `status` persiste el status final + inspecciona el fragmento
// `extra` (expires_at) que se compone como sub-template anidado.
function makeCasSql({ status = 'running', phases = {}, artifacts = [] } = {}) {
  const state = { status, phases, artifacts };
  const calls = [];
  const sql = vi.fn(async (strings, ...vals) => {
    const q = strings.join('?');
    calls.push({ q, vals });
    if (/SELECT id, status, phases, artifacts\s+FROM pitch_jobs WHERE id/.test(q)) {
      return [{ id: 'j', status: state.status, phases: state.phases, artifacts: state.artifacts }];
    }
    if (/SELECT status FROM pitch_jobs WHERE id/.test(q)) {
      return [{ status: state.status }];
    }
    if (/UPDATE pitch_jobs\s+SET phases/.test(q)) {
      const [nextPhases, nextArtifacts, , prevPhases] = vals;
      if (JSON.stringify(prevPhases) !== JSON.stringify(state.phases)) return { count: 0 };
      state.phases = nextPhases;
      state.artifacts = nextArtifacts;
      return { count: 1 };
    }
    if (/UPDATE pitch_jobs SET status/.test(q)) {
      const [finalStatus] = vals;
      state.status = finalStatus;
      return { count: 1 };
    }
    return [];
  });
  sql.json = (o) => o;
  return { sql, state, calls };
}

function doneMap(...names) {
  return Object.fromEntries(names.map((n) => [n, { status: 'done' }]));
}
function failedMap(...names) {
  return Object.fromEntries(names.map((n) => [n, { status: 'failed' }]));
}

describe('applyPhaseWebhook — cálculo de estado final', () => {
  it('todas las fases done → status succeeded, con expires_at', async () => {
    const rest = REQUIRED_PHASES.slice(0, -1);
    const last = REQUIRED_PHASES[REQUIRED_PHASES.length - 1];
    const { sql, state, calls } = makeCasSql({ phases: doneMap(...rest) });

    const out = await applyPhaseWebhook(sql, 'j', last, { ok: true });

    expect(out.status).toBe('succeeded');
    expect(state.status).toBe('succeeded');
    const expiresCall = calls.find((c) => /expires_at/.test(c.q) && c.vals[0] instanceof Date);
    expect(expiresCall).toBeDefined();
  });

  it('una fase failed y el resto done → status partial, con expires_at', async () => {
    const rest = REQUIRED_PHASES.slice(0, -2);
    const failing = REQUIRED_PHASES[REQUIRED_PHASES.length - 2];
    const last = REQUIRED_PHASES[REQUIRED_PHASES.length - 1];
    const { sql, state, calls } = makeCasSql({ phases: { ...doneMap(...rest), ...failedMap(failing) } });

    const out = await applyPhaseWebhook(sql, 'j', last, { ok: true });

    expect(out.status).toBe('partial');
    expect(state.status).toBe('partial');
    const expiresCall = calls.find((c) => /expires_at/.test(c.q) && c.vals[0] instanceof Date);
    expect(expiresCall).toBeDefined();
  });

  it('todas las fases failed → status failed, sin expires_at', async () => {
    const rest = REQUIRED_PHASES.slice(0, -1);
    const last = REQUIRED_PHASES[REQUIRED_PHASES.length - 1];
    const { sql, state, calls } = makeCasSql({ phases: failedMap(...rest) });

    const out = await applyPhaseWebhook(sql, 'j', last, { ok: false, error: 'boom' });

    expect(out.status).toBe('failed');
    expect(state.status).toBe('failed');
    const expiresCall = calls.find((c) => /expires_at/.test(c.q) && c.vals[0] instanceof Date);
    expect(expiresCall).toBeUndefined();
  });
});
