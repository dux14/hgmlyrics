import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

process.env.REPLICATE_API_TOKEN = 'r8_test_token';

const { createPrediction, getPrediction, verifyWebhookSignature } =
  await import('../api/_lib/replicate.js');

describe('verifyWebhookSignature', () => {
  const secret = 'whsec_' + Buffer.from('super-secret-key').toString('base64');
  const id = 'msg_123';
  const timestamp = '1718000000';
  const body = '{"status":"succeeded"}';

  function sign(key, content) {
    return createHmac('sha256', key).update(content).digest('base64');
  }

  it('acepta una firma válida', () => {
    const key = Buffer.from(secret.split('_')[1], 'base64');
    const sig = sign(key, `${id}.${timestamp}.${body}`);
    expect(verifyWebhookSignature({ id, timestamp, signatures: `v1,${sig}`, body, secret })).toBe(
      true,
    );
  });

  it('rechaza una firma inválida', () => {
    expect(verifyWebhookSignature({ id, timestamp, signatures: 'v1,AAAA', body, secret })).toBe(
      false,
    );
  });

  it('rechaza si falta algún header', () => {
    expect(verifyWebhookSignature({ id: '', timestamp, signatures: 'v1,x', body, secret })).toBe(
      false,
    );
  });
});

describe('createPrediction / getPrediction', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hace POST al endpoint del modelo con webhook y token', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'pred_1' }) });
    const out = await createPrediction({
      model: 'owner/model',
      input: { audio: 'https://x/audio.mp3' },
      webhook: 'https://app/api/stems/webhook?job=j1&kind=stems',
    });
    expect(out.id).toBe('pred_1');
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://api.replicate.com/v1/models/owner/model/predictions');
    expect(opts.headers.Authorization).toBe('Bearer r8_test_token');
    const body = JSON.parse(opts.body);
    expect(body.webhook).toContain('/api/stems/webhook');
    expect(body.webhook_events_filter).toEqual(['completed']);
  });

  it('lanza 502 si Replicate responde error', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 422, text: async () => 'bad input' });
    await expect(
      createPrediction({ model: 'o/m', input: {}, webhook: 'https://x' }),
    ).rejects.toMatchObject({ status: 502 });
  });

  it('getPrediction consulta por id', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'p9', status: 'succeeded' }),
    });
    const out = await getPrediction('p9');
    expect(fetch.mock.calls[0][0]).toBe('https://api.replicate.com/v1/predictions/p9');
    expect(out.status).toBe('succeeded');
  });
});
