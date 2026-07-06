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
// UPDATE de `status` persiste el status final. El fragmento `extra` (expires_at)
// se construye con una invocación SEPARADA de este mismo `sql` tag (postgres.js
// invoca tags anidados de forma sincrona), asi que aqui no es async: el valor
// que retorna esa invocacion queda embebido tal cual en los `vals` de la
// llamada UPDATE...SET status real, y es sobre ESA llamada que se afirma
// (no sobre la construccion aislada del fragmento, que existiria igual aunque
// nunca se interpolara en la query final).
function makeCasSql({ status = 'running', phases = {}, artifacts = [] } = {}) {
  const state = { status, phases, artifacts };
  const calls = [];
  const sql = vi.fn((strings, ...vals) => {
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
      // CAS real: el primer valor interpolado es el nuevo status; el último es
      // siempre el guard `AND status = ${job.status}` leído al inicio de la
      // iteración (posición robusta a cuántos fragmentos intermedios se agreguen
      // al SET, p.ej. cost_actual), y solo "gana" si sigue vigente.
      const finalStatus = vals[0];
      const guardStatus = vals[vals.length - 1];
      if (guardStatus !== state.status) return { count: 0 };
      state.status = finalStatus;
      return { count: 1 };
    }
    // Fragmentos anidados `sql`, expires_at = ${date}`` o `sql``` (vacio). Sentinel
    // distinguible para poder verificar, en la llamada real de status, cual de
    // los dos fragmentos quedo efectivamente interpolado.
    if (strings.length === 2 && /expires_at/.test(strings[0])) {
      return { __fragment: 'expires_at' };
    }
    if (strings.length === 1 && strings[0] === '') {
      return { __fragment: 'none' };
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
    const statusCall = calls.find((c) => /UPDATE pitch_jobs SET status/.test(c.q));
    expect(statusCall.vals[0]).toBe('succeeded');
    expect(statusCall.vals).toContainEqual({ __fragment: 'expires_at' });
  });

  it('una fase failed y el resto done → status partial, con expires_at', async () => {
    const rest = REQUIRED_PHASES.slice(0, -2);
    const failing = REQUIRED_PHASES[REQUIRED_PHASES.length - 2];
    const last = REQUIRED_PHASES[REQUIRED_PHASES.length - 1];
    const { sql, state, calls } = makeCasSql({ phases: { ...doneMap(...rest), ...failedMap(failing) } });

    const out = await applyPhaseWebhook(sql, 'j', last, { ok: true });

    expect(out.status).toBe('partial');
    expect(state.status).toBe('partial');
    const statusCall = calls.find((c) => /UPDATE pitch_jobs SET status/.test(c.q));
    expect(statusCall.vals[0]).toBe('partial');
    expect(statusCall.vals).toContainEqual({ __fragment: 'expires_at' });
  });

  it('todas las fases failed → status failed, sin expires_at', async () => {
    const rest = REQUIRED_PHASES.slice(0, -1);
    const last = REQUIRED_PHASES[REQUIRED_PHASES.length - 1];
    const { sql, state, calls } = makeCasSql({ phases: failedMap(...rest) });

    const out = await applyPhaseWebhook(sql, 'j', last, { ok: false, error: 'boom' });

    expect(out.status).toBe('failed');
    expect(state.status).toBe('failed');
    const statusCall = calls.find((c) => /UPDATE pitch_jobs SET status/.test(c.q));
    expect(statusCall.vals[0]).toBe('failed');
    expect(statusCall.vals).toContainEqual({ __fragment: 'none' });
  });

  it('job finaliza (succeeded) con costos parciales variados: cost_actual acumula los cost no-null de todas las fases', async () => {
    const prevPhases = {
      separation: { status: 'done', error: null, cost: 1 },
      f0: { status: 'done', error: null, cost: 2 },
      notes: { status: 'done', error: null, cost: null },
      lyrics: { status: 'done', error: null, cost: 3 },
      fusion: { status: 'done', error: null, cost: 4 },
    };
    const { sql, state, calls } = makeCasSql({ phases: prevPhases });

    // render reporta cost: null (fase sin costo asociado); las demás ya tenían cost en phases.
    const out = await applyPhaseWebhook(sql, 'j', 'render', { ok: true, cost: null });

    expect(out.status).toBe('succeeded');
    expect(state.status).toBe('succeeded');
    const statusCall = calls.find((c) => /UPDATE pitch_jobs SET status/.test(c.q));
    expect(statusCall.vals).toContain(10); // 1+2+0+3+4+0
  });

  it('job finaliza (failed) con fases fallidas: cost_actual también registra lo gastado antes de fallar', async () => {
    const rest = REQUIRED_PHASES.slice(0, -1);
    const last = REQUIRED_PHASES[REQUIRED_PHASES.length - 1];
    const prevPhases = Object.fromEntries(rest.map((p, i) => [p, { status: 'failed', error: 'x', cost: i + 1 }]));
    const { sql, state, calls } = makeCasSql({ phases: prevPhases });

    const out = await applyPhaseWebhook(sql, 'j', last, { ok: false, error: 'boom', cost: null });

    expect(out.status).toBe('failed');
    expect(state.status).toBe('failed');
    const statusCall = calls.find((c) => /UPDATE pitch_jobs SET status/.test(c.q));
    expect(statusCall.vals).toContain(15); // 1+2+3+4+5 (rest.length === 5)
  });

  it('cancelado concurrentemente entre el CAS de phases y la finalización: no se pisa a succeeded', async () => {
    const rest = REQUIRED_PHASES.slice(0, -1);
    const last = REQUIRED_PHASES[REQUIRED_PHASES.length - 1];
    const { sql } = makeCasSql({ phases: doneMap(...rest) });

    // El UPDATE de status pierde el CAS (job cancelado por el usuario justo antes);
    // el SELECT posterior confirma el estado real 'cancelled'.
    const sqlWithCancelRace = vi.fn((strings, ...vals) => {
      const q = strings.join('?');
      if (/UPDATE pitch_jobs SET status/.test(q)) return { count: 0 };
      if (/SELECT status FROM pitch_jobs WHERE id/.test(q)) return [{ status: 'cancelled' }];
      return sql(strings, ...vals);
    });
    sqlWithCancelRace.json = sql.json;

    const out = await applyPhaseWebhook(sqlWithCancelRace, 'j', last, { ok: true });

    expect(out).toEqual({ status: 'cancelled' });
  });
});

describe('applyPhaseWebhook — idempotencia por fase', () => {
  it('replay de una fase ya done no duplica artefactos ni reinicia TTL', async () => {
    const phase = REQUIRED_PHASES[0];
    const { sql, calls } = makeCasSql({
      status: 'running',
      phases: { [phase]: { status: 'done', error: null, cost: null } },
      artifacts: ['existente.wav'],
    });

    const out = await applyPhaseWebhook(sql, 'j', phase, { ok: true, artifacts: ['nuevo.wav'] });

    expect(out).toEqual({ status: 'running' });
    expect(calls.some((c) => /UPDATE pitch_jobs\s+SET phases/.test(c.q))).toBe(false);
    expect(calls.some((c) => /UPDATE pitch_jobs SET status/.test(c.q))).toBe(false);
  });

  it('webhook sobre un job ya succeeded no ejecuta ningun UPDATE', async () => {
    const { sql, calls } = makeCasSql({ status: 'succeeded', phases: doneMap(...REQUIRED_PHASES) });

    const out = await applyPhaseWebhook(sql, 'j', REQUIRED_PHASES[0], { ok: true });

    expect(out).toEqual({ status: 'succeeded' });
    expect(calls.some((c) => /UPDATE pitch_jobs\s+SET phases/.test(c.q))).toBe(false);
    expect(calls.some((c) => /UPDATE pitch_jobs SET status/.test(c.q))).toBe(false);
  });

  it('reintenta el CAS cuando otra escritura gana el primer intento', async () => {
    const rest = REQUIRED_PHASES.slice(0, -1);
    const last = REQUIRED_PHASES[REQUIRED_PHASES.length - 1];
    const { sql } = makeCasSql({ phases: doneMap(...rest) });

    let phaseUpdateAttempts = 0;
    // Envuelve el fake real: el primer intento de UPDATE...SET phases pierde el
    // CAS (count:0) simulando una escritura concurrente que gano la carrera; el
    // segundo intento, con el mismo prevPhases (el estado no cambio realmente),
    // pasa al fake real y gana.
    const sqlWithForcedRetry = vi.fn((strings, ...vals) => {
      const q = strings.join('?');
      if (/UPDATE pitch_jobs\s+SET phases/.test(q)) {
        phaseUpdateAttempts += 1;
        if (phaseUpdateAttempts === 1) return { count: 0 };
      }
      return sql(strings, ...vals);
    });
    sqlWithForcedRetry.json = sql.json;

    const out = await applyPhaseWebhook(sqlWithForcedRetry, 'j', last, { ok: true });

    expect(out.status).toBe('succeeded');
    expect(phaseUpdateAttempts).toBe(2);
  });
});
