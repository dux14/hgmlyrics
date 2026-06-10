import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

const { createModalJob, verifyModalSignature } = await import('../api/_lib/modal.js');

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
});

describe('createModalJob', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    process.env.MODAL_STEMS_ENDPOINT = 'https://modal.run/ep';
    process.env.MODAL_INBOUND_SECRET = 'inbound';
  });
  afterEach(() => vi.restoreAllMocks());

  it('POSTea al endpoint con inbound secret y devuelve callId', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ callId: 'call_1' }) });
    const out = await createModalJob({
      kind: 'stems',
      input: { audio: 'https://x/a.mp3' },
      jobId: 'j1',
      userId: 'u1',
      callbackUrl: 'https://app/cb',
    });
    expect(out.id).toBe('call_1');
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://modal.run/ep');
    expect(opts.headers['x-inbound-secret']).toBe('inbound');
    const body = JSON.parse(opts.body);
    expect(body).toMatchObject({
      kind: 'stems',
      audioUrl: 'https://x/a.mp3',
      jobId: 'j1',
      userId: 'u1',
      callbackUrl: 'https://app/cb',
    });
  });

  it('lanza 502 si Modal responde error', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' });
    await expect(
      createModalJob({
        kind: 'stems',
        input: { audio: 'x' },
        jobId: 'j',
        userId: 'u',
        callbackUrl: 'c',
      }),
    ).rejects.toMatchObject({ status: 502 });
  });
});
