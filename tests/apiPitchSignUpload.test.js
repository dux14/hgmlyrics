import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../api/_lib/db.js', () => ({ default: vi.fn() }));
vi.mock('../api/pitch/_lib/storage.js', () => ({ createPitchSignedPutUrl: vi.fn(async () => 'https://signed/put') }));
import sql from '../api/_lib/db.js';
import { createPitchSignedPutUrl } from '../api/pitch/_lib/storage.js';
import handler from '../api/pitch/sign-upload.js';
import { makeRes } from './helpers/makeRes.js';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PITCH_MODAL_INBOUND_SECRET = 's';
});

describe('api/pitch/sign-upload', () => {
  it('sin x-inbound-secret -> 401', async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { jobId: 'j', key: 'stems/lead.wav' } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(sql).not.toHaveBeenCalled();
  });

  it('job inexistente -> 404', async () => {
    sql.mockImplementation(async () => []);
    const res = makeRes();
    await handler({ method: 'POST', headers: { 'x-inbound-secret': 's' }, body: { jobId: 'j', key: 'stems/lead.wav' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('job en estado terminal -> 409', async () => {
    sql.mockImplementation(async () => [{ id: 'j', user_id: 'u1', status: 'succeeded' }]);
    const res = makeRes();
    await handler({ method: 'POST', headers: { 'x-inbound-secret': 's' }, body: { jobId: 'j', key: 'stems/lead.wav' } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(createPitchSignedPutUrl).not.toHaveBeenCalled();
  });

  it('key con traversal -> 400', async () => {
    sql.mockImplementation(async () => [{ id: 'j', user_id: 'u1', status: 'running' }]);
    const res = makeRes();
    await handler({ method: 'POST', headers: { 'x-inbound-secret': 's' }, body: { jobId: 'j', key: '../otro/x' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(createPitchSignedPutUrl).not.toHaveBeenCalled();
  });

  it('caso feliz -> 200 con url firmada, key relativa prefijada con user_id/jobId', async () => {
    sql.mockImplementation(async () => [{ id: 'j', user_id: 'u1', status: 'running' }]);
    const res = makeRes();
    await handler({ method: 'POST', headers: { 'x-inbound-secret': 's' }, body: { jobId: 'j', key: 'stems/lead.wav' } }, res);
    expect(createPitchSignedPutUrl).toHaveBeenCalledWith('u1/j/stems/lead.wav');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ url: 'https://signed/put' });
  });
});
