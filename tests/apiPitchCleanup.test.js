import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../api/_lib/db.js', () => ({ default: vi.fn() }));
vi.mock('../api/pitch/_lib/storage.js', () => ({ deletePitchPrefix: vi.fn(async () => {}) }));
import sql from '../api/_lib/db.js';
import handler from '../api/pitch/cleanup.js';
import { deletePitchPrefix } from '../api/pitch/_lib/storage.js';
import { makeRes } from './helpers/makeRes.js';
beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'c';
});

describe('api/pitch/cleanup', () => {
  it('sin bearer → 401', async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it('bearer incorrecto → 401', async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer nope' } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it('con bearer expira jobs vencidos', async () => {
    let call = 0;
    sql.mockImplementation(async () => {
      call += 1;
      // 1ª llamada: SELECT de candidatos. Resto: UPDATE final por job purgado.
      return call === 1 ? [{ id: 'j', user_id: 'u1' }] : [];
    });
    const res = makeRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer c' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
  it('con bearer y jobs vencidos: borra el storage de cada job expirado y reporta el conteo', async () => {
    let call = 0;
    sql.mockImplementation(async () => {
      call += 1;
      return call === 1
        ? [
            { id: 'j1', user_id: 'u1' },
            { id: 'j2', user_id: 'u2' },
          ]
        : [];
    });
    const res = makeRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer c' } }, res);
    expect(deletePitchPrefix).toHaveBeenCalledWith('u1/j1');
    expect(deletePitchPrefix).toHaveBeenCalledWith('u2/j2');
    expect(res.json).toHaveBeenCalledWith({ expired: 2 });
  });
  it('un borrado que falla no aborta el resto ni marca el job como expired', async () => {
    deletePitchPrefix
      .mockReset()
      .mockRejectedValueOnce(new Error('storage caído'))
      .mockResolvedValue(undefined);
    let call = 0;
    const updateCalls = [];
    sql.mockImplementation(async (strings, ...values) => {
      call += 1;
      if (call === 1) {
        return [
          { id: 'job1', user_id: 'u1' },
          { id: 'job2', user_id: 'u2' },
        ];
      }
      // UPDATE final: solo debe dispararse para el job cuyo borrado tuvo éxito (job2).
      updateCalls.push(values);
      return [];
    });
    const res = makeRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer c' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(deletePitchPrefix).toHaveBeenCalledTimes(2);
    expect(deletePitchPrefix).toHaveBeenCalledWith('u1/job1');
    expect(deletePitchPrefix).toHaveBeenCalledWith('u2/job2');
    // Solo un UPDATE (job2, el borrado exitoso); job1 se salta y se reintenta en el próximo cron.
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toContain('job2');
    expect(res.json).toHaveBeenCalledWith({ expired: 1 });
  });
  it('SEC-02: sin CRON_SECRET, Authorization: Bearer undefined → 401', async () => {
    delete process.env.CRON_SECRET;
    const res = makeRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer undefined' } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
