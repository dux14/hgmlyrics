import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyPitchSignature } from '../api/pitch/_lib/hmac.js';

const secret = 'testsecret';
const sign = (ts, body) => createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');

describe('verifyPitchSignature', () => {
  const body = JSON.stringify({ jobId: 'j', phase: 'f0' });
  it('acepta firma válida y timestamp fresco', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifyPitchSignature({ timestamp: ts, signature: sign(ts, body), body, secret })).toBe(
      true,
    );
  });
  it('rechaza firma inválida', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifyPitchSignature({ timestamp: ts, signature: 'deadbeef', body, secret })).toBe(
      false,
    );
  });
  it('rechaza timestamp viejo (>5min)', () => {
    const ts = String(Math.floor(Date.now() / 1000) - 600);
    expect(verifyPitchSignature({ timestamp: ts, signature: sign(ts, body), body, secret })).toBe(
      false,
    );
  });
  it('rechaza timestamp no numérico (no fail-open)', () => {
    expect(verifyPitchSignature({ timestamp: 'abc', signature: 'x', body, secret })).toBe(false);
  });
  it('rechaza si falta secret', () => {
    expect(verifyPitchSignature({ timestamp: '1', signature: 'x', body, secret: '' })).toBe(false);
  });
});
