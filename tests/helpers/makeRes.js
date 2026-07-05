import { vi } from 'vitest';
import { Readable } from 'node:stream';

/**
 * Test helper: request doble tipo stream (Readable) para handlers con
 * `bodyParser: false` que leen el raw body vía req.on('data'/'end'). Espeja
 * el patrón de tests/apiStemsWebhook.test.js (Readable.from + method/headers/
 * query/url) para que la firma HMAC verifique sobre el body byte a byte.
 */
export function makeReqStream(body, headers = {}) {
  const req = Readable.from([Buffer.from(body)]);
  req.method = 'POST';
  req.headers = headers;
  req.query = {};
  req.url = '/';
  return req;
}

/**
 * Test helper: `res` doble minimo con status/json espiados que encadenan
 * (`res.status(200).json(...)`), para handlers de api/**.
 */
export function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader: vi.fn(function setHeader(k, v) {
      this.headers[k] = v;
    }),
    status: vi.fn(function status(c) {
      this.statusCode = c;
      return this;
    }),
    json: vi.fn(function json(b) {
      this.body = b;
      return this;
    }),
  };
  return res;
}
