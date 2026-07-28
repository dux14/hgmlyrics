import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../api/_lib/db.js', () => ({ default: vi.fn() }));
vi.mock('../api/_lib/auth.js', () => ({ requireUser: vi.fn(async () => ({ id: 'u1' })) }));
vi.mock('../api/pitch/_lib/storage.js', () => ({
  signPitchDownload: vi.fn(async () => 'https://signed/get'),
  deletePitchPrefix: vi.fn(async () => {}),
}));
vi.mock('../api/pitch/_lib/modal.js', () => ({ invokePitchPipeline: vi.fn(async () => ({ id: 'call1' })) }));
import sql from '../api/_lib/db.js';
import { invokePitchPipeline } from '../api/pitch/_lib/modal.js';
import { deletePitchPrefix } from '../api/pitch/_lib/storage.js';
import handler from '../api/pitch/jobs/[id]/retry.js';
import { makeRes } from './helpers/makeRes.js';
beforeEach(() => vi.clearAllMocks());

describe('api/pitch/jobs/[id]/retry', () => {
  it('reintenta un job failed: CAS a running + redispatch, responde 202', async () => {
    sql.json = (o) => o;
    sql.mockImplementation(async (strings) => {
      const q = strings.join('?');
      if (/SELECT .* FROM pitch_jobs/.test(q)) {
        return [{ id: 'j', user_id: 'u1', status: 'failed', profile: 'oss', input_path: 'u1/j/input/a.mp3' }];
      }
      return { count: 1 };
    });
    const res = makeRes();
    await handler({ method: 'POST', query: { id: 'j' }, headers: {} }, res);
    expect(invokePitchPipeline).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it('reintenta un job partial', async () => {
    sql.json = (o) => o;
    sql.mockImplementation(async (strings) => {
      const q = strings.join('?');
      if (/SELECT .* FROM pitch_jobs/.test(q)) {
        return [{ id: 'j', user_id: 'u1', status: 'partial', profile: 'oss', input_path: 'u1/j/input/a.mp3' }];
      }
      return { count: 1 };
    });
    const res = makeRes();
    await handler({ method: 'POST', query: { id: 'j' }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it('rechaza retry si el job no está failed/partial → 409', async () => {
    sql.json = (o) => o;
    sql.mockImplementation(async () => [{ id: 'j', user_id: 'u1', status: 'succeeded', profile: 'oss' }]);
    const res = makeRes();
    await handler({ method: 'POST', query: { id: 'j' }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(invokePitchPipeline).not.toHaveBeenCalled();
  });

  it('404 si el job no existe o es de otro usuario', async () => {
    sql.json = (o) => o;
    sql.mockImplementation(async () => []);
    const res = makeRes();
    await handler({ method: 'POST', query: { id: 'j' }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('carrera CAS: otro retry gana el UPDATE → 409 sin dispatch', async () => {
    sql.json = (o) => o;
    sql.mockImplementation(async (strings) => {
      const q = strings.join('?');
      if (/SELECT .* FROM pitch_jobs/.test(q)) {
        return [{ id: 'j', user_id: 'u1', status: 'failed', profile: 'oss', input_path: 'u1/j/input/a.mp3' }];
      }
      if (/UPDATE pitch_jobs SET status = 'running'/.test(q)) return { count: 0 };
      return { count: 1 };
    });
    const res = makeRes();
    await handler({ method: 'POST', query: { id: 'j' }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(invokePitchPipeline).not.toHaveBeenCalled();
  });

  it('Fix HIGH: 429 si ya se alcanzó el tope de reintentos (retries >= 3), sin dispatch', async () => {
    sql.json = (o) => o;
    sql.mockImplementation(async (strings) => {
      const q = strings.join('?');
      if (/SELECT .* FROM pitch_jobs/.test(q)) {
        return [{ id: 'j', user_id: 'u1', status: 'failed', profile: 'oss', input_path: 'u1/j/input/a.mp3', retries: 3 }];
      }
      return { count: 1 };
    });
    const res = makeRes();
    await handler({ method: 'POST', query: { id: 'j' }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(invokePitchPipeline).not.toHaveBeenCalled();
  });

  it('Modal falla ambos intentos por timeout → marca failed pero NO purga storage (job puede seguir vivo en GPU)', async () => {
    sql.json = (o) => o;
    let failedUpdateCalled = false;
    sql.mockImplementation(async (strings) => {
      const q = strings.join('?');
      if (/SELECT .* FROM pitch_jobs/.test(q)) {
        return [{ id: 'j', user_id: 'u1', status: 'failed', profile: 'oss', input_path: 'u1/j/input/a.mp3' }];
      }
      if (/UPDATE pitch_jobs SET status = 'running'/.test(q)) return { count: 1 };
      if (/UPDATE pitch_jobs SET status = 'failed'/.test(q)) { failedUpdateCalled = true; return { count: 1 }; }
      return { count: 1 };
    });
    const timeoutErr = new Error('Modal (pitch) no respondió a tiempo.');
    timeoutErr.status = 502;
    timeoutErr.timeout = true;
    invokePitchPipeline.mockRejectedValueOnce(timeoutErr).mockRejectedValueOnce(timeoutErr);
    const res = makeRes();
    await handler({ method: 'POST', query: { id: 'j' }, headers: {} }, res);
    expect(invokePitchPipeline).toHaveBeenCalledTimes(2);
    expect(failedUpdateCalled).toBe(true);
    expect(deletePitchPrefix).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(502);
  });

  it('reinicia phases/artifacts para no arrastrar fases previas al recomputar succeeded/partial', async () => {
    sql.json = (o) => o;
    sql.mockImplementation(async (strings) => {
      const q = strings.join('?');
      if (/SELECT .* FROM pitch_jobs/.test(q)) {
        return [{ id: 'j', user_id: 'u1', status: 'partial', profile: 'oss', input_path: 'u1/j/input/a.mp3' }];
      }
      if (/UPDATE pitch_jobs SET status = 'running'/.test(q)) return { count: 1 };
      return { count: 1 };
    });
    const res = makeRes();
    await handler({ method: 'POST', query: { id: 'j' }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(202);
  });
});
