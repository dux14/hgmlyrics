import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/_lib/db.js', () => ({ default: vi.fn() }));
vi.mock('../api/_lib/auth.js', () => ({ requireUser: vi.fn(async () => ({ id: 'u1' })) }));
vi.mock('../api/pitch/_lib/storage.js', () => ({
  createPitchUploadUrl: vi.fn(async () => ({ path: 'p', token: 't' })),
  deletePitchPrefix: vi.fn(async () => {}),
}));

import sql from '../api/_lib/db.js';
import { createPitchUploadUrl } from '../api/pitch/_lib/storage.js';
import handler from '../api/pitch/jobs.js';
import { makeRes } from './helpers/makeRes.js';

const DAILY_QUOTA = 2; // debe reflejar api/pitch/_lib/state.js

beforeEach(() => vi.clearAllMocks());

/**
 * Enruta el mock de `sql` (tagged template) por el texto de cada query, igual
 * que apiStemsJobs.test.js. `handlers` es una lista [substring, resultado|fn].
 */
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
}

const postReq = (over = {}) => ({
  method: 'POST',
  body: { filename: 'a.mp3', size: 1024, mime: 'audio/mpeg' },
  ...over,
});

describe('api/pitch/jobs', () => {
  it('POST feliz (bajo cuota) → 200 con job + upload', async () => {
    routeSql([
      ['SELECT is_admin FROM profiles', [{ is_admin: false }]],
      ['RETURNING id, input_path', []], // reclamo de huérfanos: ninguno
      ['SELECT count(*)::int AS n FROM pitch_jobs', [{ n: 0 }]],
      ['INSERT INTO pitch_jobs', [{ id: 'j1', status: 'created', profile: 'oss', created_at: 't' }]],
      ['UPDATE pitch_jobs SET input_path', []],
    ]);
    const res = makeRes();
    await handler(postReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      job: { id: 'j1', status: 'created', profile: 'oss', created_at: 't' },
      upload: { path: 'p', token: 't' },
    });
    expect(createPitchUploadUrl).toHaveBeenCalledWith('u1/j1/input/a.mp3');
  });

  it('POST puebla sha256 en el INSERT cuando el cliente lo envía', async () => {
    let insertedValues;
    routeSql([
      ['SELECT is_admin FROM profiles', [{ is_admin: false }]],
      ['RETURNING id, input_path', []], // reclamo de huérfanos: ninguno
      ['SELECT count(*)::int AS n FROM pitch_jobs', [{ n: 0 }]],
      ['INSERT INTO pitch_jobs', (values) => {
        insertedValues = values;
        return [{ id: 'j1', status: 'created', profile: 'oss', created_at: 't' }];
      }],
      ['UPDATE pitch_jobs SET input_path', []],
    ]);
    const res = makeRes();
    await handler(postReq({ body: { filename: 'a.mp3', size: 1024, mime: 'audio/mpeg', sha256: 'a'.repeat(64) } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(insertedValues).toContain('a'.repeat(64));
  });

  it('POST rechaza sha256 con formato inválido → 400 sin insertar', async () => {
    let insertCalled = false;
    routeSql([
      ['SELECT is_admin FROM profiles', [{ is_admin: false }]],
      ['RETURNING id, input_path', []],
      ['SELECT count(*)::int AS n FROM pitch_jobs', [{ n: 0 }]],
      ['INSERT INTO pitch_jobs', () => { insertCalled = true; return []; }],
    ]);
    const res = makeRes();
    await handler(postReq({ body: { filename: 'a.mp3', size: 1024, mime: 'audio/mpeg', sha256: 'no-es-un-hash' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(insertCalled).toBe(false);
  });

  it('POST con cuota agotada (no-admin) → 429', async () => {
    routeSql([
      ['SELECT is_admin FROM profiles', [{ is_admin: false }]],
      ['RETURNING id, input_path', []],
      ['SELECT count(*)::int AS n FROM pitch_jobs', [{ n: DAILY_QUOTA }]],
    ]);
    const res = makeRes();
    await handler(postReq(), res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ error: 'quota', reason: 'quota' });
  });

  it('POST: carrera del índice único (23505) en el INSERT → 429 igual que cuota', async () => {
    const dupError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint_name: 'pitch_jobs_one_active_per_user',
    });
    routeSql([
      ['SELECT is_admin FROM profiles', [{ is_admin: false }]],
      ['RETURNING id, input_path', []],
      ['SELECT count(*)::int AS n FROM pitch_jobs', [{ n: 0 }]],
      ['INSERT INTO pitch_jobs', { __reject: dupError }],
    ]);
    const res = makeRes();
    await handler(postReq(), res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ error: 'quota', reason: 'quota' });
  });

  it('POST: 23505 de OTRA constraint no se enmascara como cuota: se relanza (500)', async () => {
    const otherDup = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint_name: 'otra_constraint_cualquiera',
    });
    routeSql([
      ['SELECT is_admin FROM profiles', [{ is_admin: false }]],
      ['RETURNING id, input_path', []],
      ['SELECT count(*)::int AS n FROM pitch_jobs', [{ n: 0 }]],
      ['INSERT INTO pitch_jobs', { __reject: otherDup }],
    ]);
    const res = makeRes();
    await handler(postReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal error' });
  });

  it('GET → 200 con jobs + quota', async () => {
    routeSql([
      ['SELECT id, status, profile, input_meta', [{ id: 'j1', status: 'succeeded', profile: 'oss' }]],
      ['SELECT count(*)::int AS n FROM pitch_jobs', [{ n: 1 }]],
      ['SELECT is_admin FROM profiles', [{ is_admin: false }]],
    ]);
    const res = makeRes();
    await handler({ method: 'GET' }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      jobs: [{ id: 'j1', status: 'succeeded', profile: 'oss' }],
      quota: { used: 1, limit: DAILY_QUOTA },
    });
  });

  it('GET admin: quota unlimited', async () => {
    routeSql([
      ['SELECT id, status, profile, input_meta', [{ id: 'j1', status: 'succeeded', profile: 'oss' }]],
      ['SELECT count(*)::int AS n FROM pitch_jobs', [{ n: 5 }]],
      ['SELECT is_admin FROM profiles', [{ is_admin: true }]],
    ]);
    const res = makeRes();
    await handler({ method: 'GET' }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      jobs: [{ id: 'j1', status: 'succeeded', profile: 'oss' }],
      quota: { used: 5, limit: null, unlimited: true },
    });
  });

  it('Fix HIGH: la cuota se cuenta por dispatched_at, no por status (cierra el bypass aprobar→cancelar→repetir)', async () => {
    routeSql([
      ['SELECT is_admin FROM profiles', [{ is_admin: false }]],
      ['RETURNING id, input_path', []],
      ['SELECT count(*)::int AS n FROM pitch_jobs', [{ n: 0 }]],
      ['INSERT INTO pitch_jobs', [{ id: 'j1', status: 'created', profile: 'oss', created_at: 't' }]],
      ['UPDATE pitch_jobs SET input_path', []],
    ]);
    const res = makeRes();
    await handler(postReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    // La query de cuota ya no filtra por status (un job aprobado-y-cancelado seguiría
    // contando por su dispatched_at de hoy, en vez de resetear la cuota a 0).
    const quotaCall = sql.mock.calls.find(([strings]) =>
      strings.join('?').includes('SELECT count(*)::int AS n FROM pitch_jobs'),
    );
    expect(quotaCall).toBeTruthy();
    const queryText = quotaCall[0].join('?');
    expect(queryText).not.toMatch(/status IN/);
    expect(queryText).toMatch(/dispatched_at/);
  });

  it('método no permitido (DELETE) → 405', async () => {
    const res = makeRes();
    await handler({ method: 'DELETE' }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
