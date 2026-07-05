import { vi } from 'vitest';

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
