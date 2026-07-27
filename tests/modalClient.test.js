import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

const { verifyModalSignature, invokeModalPipeline } = await import('../api/_lib/modal.js');

function sign(secret, timestamp, body) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

describe('verifyModalSignature', () => {
  const secret = 'modalsecret123';
  const body = '{"status":"succeeded"}';
  const now = () => String(Math.floor(Date.now() / 1000));

  it('acepta firma válida con timestamp reciente', () => {
    const ts = now();
    expect(
      verifyModalSignature({ timestamp: ts, signature: sign(secret, ts, body), body, secret }),
    ).toBe(true);
  });
  it('rechaza firma inválida', () => {
    const ts = now();
    expect(verifyModalSignature({ timestamp: ts, signature: 'deadbeef', body, secret })).toBe(
      false,
    );
  });
  it('rechaza si falta el secret', () => {
    const ts = now();
    expect(
      verifyModalSignature({ timestamp: ts, signature: sign(secret, ts, body), body, secret: '' }),
    ).toBe(false);
  });
  it('rechaza timestamp fuera de ±5 min (anti-replay)', () => {
    const old = String(Math.floor(Date.now() / 1000) - 6 * 60);
    expect(
      verifyModalSignature({ timestamp: old, signature: sign(secret, old, body), body, secret }),
    ).toBe(false);
  });
  it('Fix 3: rechaza timestamp no numérico en vez de fail-open (NaN > umbral es false)', () => {
    const bogus = 'no-soy-un-numero';
    expect(
      verifyModalSignature({
        timestamp: bogus,
        signature: sign(secret, bogus, body),
        body,
        secret,
      }),
    ).toBe(false);
  });
});

describe('invokeModalPipeline', () => {
  const payload = {
    jobId: 'job1',
    input: { getUrl: 'https://signed/input.mp3' },
    enabledSections: ['structure'],
    uploads: {},
    webhook: { url: 'https://x/api/stems/webhook', secret: 'whsecret' },
  };

  beforeEach(() => {
    process.env.MODAL_STEMS_ENDPOINT = 'https://modal.run/ep';
    process.env.MODAL_INBOUND_SECRET = 'inbound';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Fix 3: fetch aborta por timeout (AbortError) → error con status 502 y mensaje claro', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    );

    await expect(invokeModalPipeline(payload)).rejects.toMatchObject({
      status: 502,
      message: expect.stringMatching(/no respondió a tiempo/i),
    });
  });

  it('Fix 3: fetch aborta por TimeoutError (AbortSignal.timeout) → error con status 502', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' })),
    );

    await expect(invokeModalPipeline(payload)).rejects.toMatchObject({ status: 502 });
  });

  it('falla de red genérica (no abort) → error con status 502 y detalle del mensaje original', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));

    await expect(invokeModalPipeline(payload)).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('ECONNRESET'),
    });
  });

  it('pasa AbortSignal.timeout(MODAL_DISPATCH_TIMEOUT_MS) a fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ callId: 'call_xyz' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await invokeModalPipeline(payload);

    expect(result).toEqual({ id: 'call_xyz' });
    const options = mockFetch.mock.calls[0][1];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('respuesta !ok → error con status 502 (comportamiento previo preservado)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'boom',
      }),
    );

    await expect(invokeModalPipeline(payload)).rejects.toMatchObject({ status: 502 });
  });
});
