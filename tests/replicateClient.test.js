import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

process.env.REPLICATE_API_TOKEN = 'r8_test_token';

const { createPrediction, getPrediction, verifyWebhookSignature } =
  await import('../api/_lib/replicate.js');

describe('verifyWebhookSignature', () => {
  const secret = 'whsec_' + Buffer.from('super-secret-key').toString('base64');
  const id = 'msg_123';
  const body = '{"status":"succeeded"}';

  function currentTimestamp() {
    return String(Math.floor(Date.now() / 1000));
  }

  function sign(key, content) {
    return createHmac('sha256', key).update(content).digest('base64');
  }

  it('acepta una firma válida con timestamp reciente', () => {
    const timestamp = currentTimestamp();
    const key = Buffer.from(secret.split('_')[1], 'base64');
    const sig = sign(key, `${id}.${timestamp}.${body}`);
    expect(verifyWebhookSignature({ id, timestamp, signatures: `v1,${sig}`, body, secret })).toBe(
      true,
    );
  });

  it('rechaza una firma inválida', () => {
    const timestamp = currentTimestamp();
    expect(verifyWebhookSignature({ id, timestamp, signatures: 'v1,AAAA', body, secret })).toBe(
      false,
    );
  });

  it('rechaza si falta algún header', () => {
    const timestamp = currentTimestamp();
    expect(verifyWebhookSignature({ id: '', timestamp, signatures: 'v1,x', body, secret })).toBe(
      false,
    );
  });

  it('rechaza timestamp fuera de la tolerancia de ±5 min (anti-replay)', () => {
    // Timestamp de hace 6 minutos → fuera de tolerancia
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 6 * 60);
    const key = Buffer.from(secret.split('_')[1], 'base64');
    const sig = sign(key, `${id}.${oldTimestamp}.${body}`);
    expect(
      verifyWebhookSignature({
        id,
        timestamp: oldTimestamp,
        signatures: `v1,${sig}`,
        body,
        secret,
      }),
    ).toBe(false);
  });
});

describe('createPrediction / getPrediction', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resuelve la versión y hace POST a /v1/predictions con webhook y token', async () => {
    // 1) GET /models/{owner}/{name} → última versión; 2) POST /predictions
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ latest_version: { id: 'ver_abc' } }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'pred_1' }) });
    const out = await createPrediction({
      model: 'owner/model',
      input: { audio: 'https://x/audio.mp3' },
      webhook: 'https://app/api/stems/webhook?job=j1&kind=stems',
    });
    expect(out.id).toBe('pred_1');
    expect(fetch.mock.calls[0][0]).toBe('https://api.replicate.com/v1/models/owner/model');
    const [url, opts] = fetch.mock.calls[1];
    expect(url).toBe('https://api.replicate.com/v1/predictions');
    expect(opts.headers.Authorization).toBe('Bearer r8_test_token');
    const body = JSON.parse(opts.body);
    expect(body.version).toBe('ver_abc');
    expect(body.webhook).toContain('/api/stems/webhook');
    expect(body.webhook_events_filter).toEqual(['completed']);
  });

  it('lanza 502 si el modelo no tiene versión disponible', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ latest_version: null }) });
    await expect(
      createPrediction({ model: 'o/m', input: {}, webhook: 'https://x' }),
    ).rejects.toMatchObject({ status: 502 });
  });

  it('lanza 502 si Replicate responde error al resolver el modelo', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'not found' });
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
