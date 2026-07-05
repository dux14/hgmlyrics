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
    sql.mockImplementation(async () => [{ id: 'j', user_id: 'u1' }]);
    const res = makeRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer c' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
  it('con bearer y jobs vencidos: borra el storage de cada job expirado y reporta el conteo', async () => {
    sql.mockImplementation(async () => [
      { id: 'j1', user_id: 'u1' },
      { id: 'j2', user_id: 'u2' },
    ]);
    const res = makeRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer c' } }, res);
    expect(deletePitchPrefix).toHaveBeenCalledWith('u1/j1');
    expect(deletePitchPrefix).toHaveBeenCalledWith('u2/j2');
    expect(res.json).toHaveBeenCalledWith({ expired: 2 });
  });
});
