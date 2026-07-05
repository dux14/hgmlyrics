import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../api/_lib/db.js', () => ({ default: vi.fn() }));
vi.mock('../api/_lib/auth.js', () => ({ requireUser: vi.fn(async () => ({ id: 'u1' })) }));
vi.mock('../api/pitch/_lib/storage.js', () => ({ signPitchDownload: vi.fn(async () => 'https://signed/get') }));
vi.mock('../api/pitch/_lib/modal.js', () => ({ invokePitchPipeline: vi.fn(async () => ({ id: 'call1' })) }));
import sql from '../api/_lib/db.js';
import { invokePitchPipeline } from '../api/pitch/_lib/modal.js';
import handler from '../api/pitch/jobs/[id]/approve.js';
import { makeRes } from './helpers/makeRes.js';
beforeEach(() => vi.clearAllMocks());

describe('api/pitch/jobs/[id]/approve', () => {
  it('approve despacha y responde 202', async () => {
    sql.json = (o) => o;
    sql.mockImplementation(async (strings) => {
      const q = strings.join('?');
      if (/SELECT .* FROM pitch_jobs/.test(q)) return [{ id: 'j', user_id: 'u1', status: 'awaiting_approval', profile: 'oss', input_path: 'u1/j/input/a.mp3' }];
      return { count: 1 };
    });
    const res = makeRes();
    await handler({ method: 'POST', query: { id: 'j' }, headers: {} }, res);
    expect(invokePitchPipeline).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it('rechaza approve si no está en awaiting_approval → 409', async () => {
    sql.json = (o) => o;
    sql.mockImplementation(async () => [{ id: 'j', user_id: 'u1', status: 'created', profile: 'oss' }]);
    const res = makeRes();
    await handler({ method: 'POST', query: { id: 'j' }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('404 si el job no existe o es de otro usuario', async () => {
    sql.json = (o) => o;
    sql.mockImplementation(async () => []);
    const res = makeRes();
    await handler({ method: 'POST', query: { id: 'j' }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(invokePitchPipeline).not.toHaveBeenCalled();
  });

  it('carrera CAS: otro approve gana el UPDATE → 409 sin dispatch', async () => {
    sql.json = (o) => o;
    sql.mockImplementation(async (strings) => {
      const q = strings.join('?');
      if (/SELECT .* FROM pitch_jobs/.test(q)) return [{ id: 'j', user_id: 'u1', status: 'awaiting_approval', profile: 'oss', input_path: 'u1/j/input/a.mp3' }];
      if (/UPDATE pitch_jobs SET status = 'running'/.test(q)) return { count: 0 };
      return { count: 1 };
    });
    const res = makeRes();
    await handler({ method: 'POST', query: { id: 'j' }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(invokePitchPipeline).not.toHaveBeenCalled();
  });

  it('Modal falla ambos intentos → marca failed (no running) y responde 502', async () => {
    sql.json = (o) => o;
    let failedUpdateCalled = false;
    sql.mockImplementation(async (strings) => {
      const q = strings.join('?');
      if (/SELECT .* FROM pitch_jobs/.test(q)) return [{ id: 'j', user_id: 'u1', status: 'awaiting_approval', profile: 'oss', input_path: 'u1/j/input/a.mp3' }];
      if (/UPDATE pitch_jobs SET status = 'running'/.test(q)) return { count: 1 };
      if (/UPDATE pitch_jobs SET status = 'failed'/.test(q)) { failedUpdateCalled = true; return { count: 1 }; }
      return { count: 1 };
    });
    invokePitchPipeline.mockRejectedValue(new Error('modal down'));
    const res = makeRes();
    await handler({ method: 'POST', query: { id: 'j' }, headers: {} }, res);
    expect(invokePitchPipeline).toHaveBeenCalledTimes(2);
    expect(failedUpdateCalled).toBe(true);
    expect(res.status).toHaveBeenCalledWith(502);
  });

  it('Modal falla el 1er intento y pasa el reintento → 202 y no marca failed', async () => {
    sql.json = (o) => o;
    let failedUpdateCalled = false;
    sql.mockImplementation(async (strings) => {
      const q = strings.join('?');
      if (/SELECT .* FROM pitch_jobs/.test(q)) return [{ id: 'j', user_id: 'u1', status: 'awaiting_approval', profile: 'oss', input_path: 'u1/j/input/a.mp3' }];
      if (/UPDATE pitch_jobs SET status = 'running'/.test(q)) return { count: 1 };
      if (/UPDATE pitch_jobs SET status = 'failed'/.test(q)) { failedUpdateCalled = true; return { count: 1 }; }
      return { count: 1 };
    });
    invokePitchPipeline.mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce({ id: 'call1' });
    const res = makeRes();
    await handler({ method: 'POST', query: { id: 'j' }, headers: {} }, res);
    expect(invokePitchPipeline).toHaveBeenCalledTimes(2);
    expect(failedUpdateCalled).toBe(false);
    expect(res.status).toHaveBeenCalledWith(202);
  });
});
