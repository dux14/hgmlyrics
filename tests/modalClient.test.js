import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';

const { verifyModalSignature } = await import('../api/_lib/modal.js');

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
