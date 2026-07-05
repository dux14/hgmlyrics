import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../api/_lib/db.js', () => ({ default: vi.fn() }));
vi.mock('../api/_lib/auth.js', () => ({ requireUser: vi.fn(async () => ({ id: 'u1' })) }));
vi.mock('../api/pitch/_lib/storage.js', () => ({ signPitchDownload: vi.fn(async () => 'https://get') }));
import sql from '../api/_lib/db.js';
import { signPitchDownload } from '../api/pitch/_lib/storage.js';
import detail from '../api/pitch/jobs/[id].js';
import cancel from '../api/pitch/jobs/[id]/cancel.js';
import { makeRes } from './helpers/makeRes.js';
beforeEach(() => vi.clearAllMocks());

describe('api/pitch/jobs/[id] (detalle + cancel)', () => {
  it('GET detalle devuelve el job del usuario', async () => {
    sql.mockImplementation(async () => [{ id: 'j', user_id: 'u1', status: 'running', phases: {}, artifacts: [] }]);
    const res = makeRes();
    await detail({ method: 'GET', query: { id: 'j' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('GET job de otro usuario o inexistente devuelve 404', async () => {
    sql.mockImplementation(async () => []);
    const res = makeRes();
    await detail({ method: 'GET', query: { id: 'ajeno' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('GET con artefactos devuelve URLs firmadas', async () => {
    sql.mockImplementation(async () => [
      {
        id: 'j',
        user_id: 'u1',
        status: 'succeeded',
        phases: {},
        artifacts: [{ storage_uri: 'u1/j/render/x.svg', kind: 'svg' }],
      },
    ]);
    const res = makeRes();
    await detail({ method: 'GET', query: { id: 'j' } }, res);
    expect(signPitchDownload).toHaveBeenCalledWith('u1/j/render/x.svg');
    expect(res.body.artifacts[0].url).toBe('https://get');
  });

  it('cancel marca cancelled', async () => {
    sql.mockImplementation(async (strings) => {
      const q = strings.join('?');
      if (/SELECT/.test(q)) return [{ id: 'j', user_id: 'u1', status: 'running' }];
      return { count: 1 };
    });
    const res = makeRes();
    await cancel({ method: 'POST', query: { id: 'j' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('cancel de un estado no cancelable devuelve 409 sin UPDATE', async () => {
    const updateSpy = vi.fn();
    sql.mockImplementation(async (strings) => {
      const q = strings.join('?');
      if (/SELECT/.test(q)) return [{ id: 'j', user_id: 'u1', status: 'succeeded' }];
      updateSpy();
      return { count: 1 };
    });
    const res = makeRes();
    await cancel({ method: 'POST', query: { id: 'j' } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('cancel con carrera CAS (UPDATE pisado) devuelve 409', async () => {
    sql.mockImplementation(async (strings) => {
      const q = strings.join('?');
      if (/SELECT/.test(q)) return [{ id: 'j', user_id: 'u1', status: 'running' }];
      return { count: 0 };
    });
    const res = makeRes();
    await cancel({ method: 'POST', query: { id: 'j' } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('cancel de job inexistente devuelve 404', async () => {
    sql.mockImplementation(async () => []);
    const res = makeRes();
    await cancel({ method: 'POST', query: { id: 'nope' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
