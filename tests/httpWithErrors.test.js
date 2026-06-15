/**
 * httpWithErrors.test.js — TDD para withErrors en api/_lib/http.js (SEC-10)
 * Verifica que errores 5xx ocultan el mensaje real al cliente.
 */
import { describe, it, expect } from 'vitest';
import { withErrors } from '../api/_lib/http.js';

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

describe('withErrors', () => {
  it('errores con status < 500 conservan e.message en la respuesta', async () => {
    const handler = withErrors(async () => {
      const err = new Error('campo_invalido');
      err.status = 400;
      throw err;
    });

    const res = makeRes();
    await handler({}, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'campo_invalido' });
  });

  it('errores sin .status (simulando error de Postgres) devuelven 500 con mensaje generico', async () => {
    const pgMessage = 'null value in column "x" violates not-null constraint';
    const handler = withErrors(async () => {
      throw new Error(pgMessage);
    });

    const res = makeRes();
    await handler({}, res);

    expect(res.statusCode).toBe(500);
    // El mensaje real NO debe filtrarse al cliente
    expect(res.body.error).not.toContain(pgMessage);
    expect(res.body).toEqual({ error: 'Internal error' });
  });

  it('errores con status >= 500 (ej. 503) tambien ocultan el mensaje', async () => {
    const handler = withErrors(async () => {
      const err = new Error('Service Unavailable detail');
      err.status = 503;
      throw err;
    });

    const res = makeRes();
    await handler({}, res);

    expect(res.statusCode).toBe(503);
    expect(res.body.error).not.toContain('Service Unavailable detail');
    expect(res.body).toEqual({ error: 'Internal error' });
  });

  it('handlers que no lanzan se ejecutan normalmente', async () => {
    const handler = withErrors(async (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const res = makeRes();
    await handler({}, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
