import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
vi.mock('../api/_lib/db.js', () => ({ default: vi.fn() }));
vi.mock('../api/pitch/_lib/process.js', () => ({
  applyPhaseWebhook: vi.fn(async () => ({ status: 'running' })),
  REQUIRED_PHASES: ['separation', 'f0', 'notes', 'lyrics', 'fusion', 'render'],
}));
import handler from '../api/pitch/webhook.js';
import { applyPhaseWebhook } from '../api/pitch/_lib/process.js';
import { makeReqStream, makeRes } from './helpers/makeRes.js';
beforeEach(() => {
  vi.clearAllMocks();
  process.env.PITCH_MODAL_WEBHOOK_SECRET = 's';
});

function sign(body, ts) {
  return createHmac('sha256', 's').update(`${ts}.${body}`).digest('hex');
}

describe('api/pitch/webhook', () => {
  it('firma inválida → 401', async () => {
    const body = JSON.stringify({ jobId: 'j', phase: 'f0', result: {} });
    const req = makeReqStream(body, {
      'x-modal-timestamp': String(Math.floor(Date.now() / 1000)),
      'x-modal-signature': 'bad',
    });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('firma válida → 200', async () => {
    const body = JSON.stringify({ jobId: 'j', phase: 'f0', result: { ok: true } });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac('sha256', 's').update(`${ts}.${body}`).digest('hex');
    const req = makeReqStream(body, { 'x-modal-timestamp': ts, 'x-modal-signature': sig });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('phase inválida (no en REQUIRED_PHASES) con firma válida → 400, applyPhaseWebhook no se llama', async () => {
    const body = JSON.stringify({ jobId: 'j', phase: 'bogus', result: {} });
    const ts = String(Math.floor(Date.now() / 1000));
    const req = makeReqStream(body, { 'x-modal-timestamp': ts, 'x-modal-signature': sign(body, ts) });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(applyPhaseWebhook).not.toHaveBeenCalled();
  });

  it('falta jobId con firma válida → 400', async () => {
    const body = JSON.stringify({ phase: 'f0', result: {} });
    const ts = String(Math.floor(Date.now() / 1000));
    const req = makeReqStream(body, { 'x-modal-timestamp': ts, 'x-modal-signature': sign(body, ts) });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('falta phase con firma válida → 400', async () => {
    const body = JSON.stringify({ jobId: 'j', result: {} });
    const ts = String(Math.floor(Date.now() / 1000));
    const req = makeReqStream(body, { 'x-modal-timestamp': ts, 'x-modal-signature': sign(body, ts) });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('applyPhaseWebhook devuelve null (job inexistente) con firma válida → 404', async () => {
    applyPhaseWebhook.mockResolvedValueOnce(null);
    const body = JSON.stringify({ jobId: 'j', phase: 'f0', result: {} });
    const ts = String(Math.floor(Date.now() / 1000));
    const req = makeReqStream(body, { 'x-modal-timestamp': ts, 'x-modal-signature': sign(body, ts) });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('método GET → 405', async () => {
    const body = '';
    const req = makeReqStream(body, {});
    req.method = 'GET';
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
