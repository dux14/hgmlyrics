import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../api/_lib/db.js', () => ({ default: vi.fn() }));
vi.mock('../api/_lib/auth.js', () => ({ requireUser: vi.fn(async () => ({ id: 'u1' })) }));
import sql from '../api/_lib/db.js';
import handler from '../api/pitch/jobs/[id]/estimate.js';
import { makeRes } from './helpers/makeRes.js';
beforeEach(() => vi.clearAllMocks());

describe('api/pitch/jobs/[id]/estimate', () => {
  it('estima y pasa a awaiting_approval', async () => {
    sql.json = (o) => o;
    sql.mockImplementation(async (strings) => {
      const q = strings.join('?');
      if (/SELECT .* FROM pitch_jobs/.test(q)) {
        return [{ id: 'j', user_id: 'u1', status: 'created', profile: 'precision' }];
      }
      return { count: 1 };
    });
    const res = makeRes();
    await handler({ method: 'POST', query: { id: 'j' }, body: { durationSec: 180 } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    // precision ahora es OSS sin costo USD (AudioShake descartado): estima 0, igual que oss.
    expect(payload.estimate.hi).toBe(0);
    expect(payload.status).toBe('awaiting_approval');
  });

  it('rechaza job de otro usuario → 404', async () => {
    sql.json = (o) => o;
    sql.mockImplementation(async () => []);
    const res = makeRes();
    await handler({ method: 'POST', query: { id: 'j' }, body: { durationSec: 10 } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it.each([undefined, 0, -5, 'abc'])(
    'durationSec inválido (%s) → 400 sin tocar la DB',
    async (durationSec) => {
      const res = makeRes();
      await handler({ method: 'POST', query: { id: 'j' }, body: { durationSec } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(sql).not.toHaveBeenCalled();
    },
  );

  it.each(['running', 'awaiting_approval'])('estado no estimable (%s) → 409', async (status) => {
    sql.json = (o) => o;
    sql.mockImplementation(async (strings) => {
      const q = strings.join('?');
      if (/SELECT .* FROM pitch_jobs/.test(q)) {
        return [{ id: 'j', user_id: 'u1', status, profile: 'precision' }];
      }
      return { count: 1 };
    });
    const res = makeRes();
    await handler({ method: 'POST', query: { id: 'j' }, body: { durationSec: 120 } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('carrera CAS: otra transición gana entre SELECT y UPDATE → 409', async () => {
    sql.json = (o) => o;
    sql.mockImplementation(async (strings) => {
      const q = strings.join('?');
      if (/SELECT .* FROM pitch_jobs/.test(q)) {
        return [{ id: 'j', user_id: 'u1', status: 'created', profile: 'precision' }];
      }
      if (/UPDATE pitch_jobs/.test(q)) {
        return { count: 0 };
      }
      return { count: 1 };
    });
    const res = makeRes();
    await handler({ method: 'POST', query: { id: 'j' }, body: { durationSec: 180 } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });
});
