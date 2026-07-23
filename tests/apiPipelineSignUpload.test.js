import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/_lib/db.js', () => ({ default: vi.fn() }));
vi.mock('../api/pitch/_lib/storage.js', () => ({
  createPitchSignedPutUrl: vi.fn(async (key) => `https://signed/put/${key}`),
}));

import sql from '../api/_lib/db.js';
import { createPitchSignedPutUrl } from '../api/pitch/_lib/storage.js';
import handler from '../api/pipeline/sign-upload.js';
import { makeRes } from './helpers/makeRes.js';

const SECRET = 'shh-secreto';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PITCH_MODAL_INBOUND_SECRET = SECRET;
});

function routeSql(handlers) {
  sql.mockImplementation(async (strings, ...values) => {
    const text = strings.join('?');
    for (const [needle, result] of handlers) {
      if (text.includes(needle)) {
        if (typeof result === 'function') return result(values);
        return result;
      }
    }
    return [];
  });
}

describe('POST /api/pipeline/sign-upload', () => {
  it('401 sin x-inbound-secret válido', async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { jobId: 'r1', key: 'f0/lead.json' } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(createPitchSignedPutUrl).not.toHaveBeenCalled();
  });

  it('404 si el jobId no es un run', async () => {
    routeSql([['song_pipeline_runs', []]]);
    const res = makeRes();
    await handler(
      {
        method: 'POST',
        headers: { 'x-inbound-secret': SECRET },
        body: { jobId: 'run-x', key: 'stems/lead.wav' },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('409 si la fase pitch no está running', async () => {
    routeSql([
      [
        'song_pipeline_runs',
        [{ id: 'r1', songId: 's1', status: 'running', phases: { pitch: { status: 'done' } } }],
      ],
    ]);
    const res = makeRes();
    await handler(
      {
        method: 'POST',
        headers: { 'x-inbound-secret': SECRET },
        body: { jobId: 'r1', key: 'f0/lead.json' },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('409 si el run no está activo (purgado) aunque phases.pitch siga running', async () => {
    routeSql([
      [
        'song_pipeline_runs',
        [{ id: 'r1', songId: 's1', status: 'cancelled', phases: { pitch: { status: 'running' } } }],
      ],
    ]);
    const res = makeRes();
    await handler(
      {
        method: 'POST',
        headers: { 'x-inbound-secret': SECRET },
        body: { jobId: 'r1', key: 'f0/lead.json' },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(createPitchSignedPutUrl).not.toHaveBeenCalled();
  });

  it('400 con key inválida (traversal)', async () => {
    routeSql([
      [
        'song_pipeline_runs',
        [{ id: 'r1', songId: 's1', status: 'running', phases: { pitch: { status: 'running' } } }],
      ],
    ]);
    const res = makeRes();
    await handler(
      {
        method: 'POST',
        headers: { 'x-inbound-secret': SECRET },
        body: { jobId: 'r1', key: '../otro' },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(createPitchSignedPutUrl).not.toHaveBeenCalled();
  });

  it('firma con prefijo pipeline/<songId>/<runId>/', async () => {
    routeSql([
      [
        'song_pipeline_runs',
        [{ id: 'r1', songId: 's1', status: 'running', phases: { pitch: { status: 'running' } } }],
      ],
    ]);
    const res = makeRes();
    await handler(
      {
        method: 'POST',
        headers: { 'x-inbound-secret': SECRET },
        body: { jobId: 'r1', key: 'f0/lead.json' },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      url: 'https://signed/put/pipeline/s1/r1/f0/lead.json',
    });
    expect(createPitchSignedPutUrl).toHaveBeenCalledWith('pipeline/s1/r1/f0/lead.json');
  });
});
