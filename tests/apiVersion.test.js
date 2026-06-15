/**
 * apiVersion.test.js — SEC-18: dataVersion devuelve hash opaco, no epoch unix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock postgres before importing the handler
const mockSql = vi.fn();
vi.mock('../api/_lib/db.js', () => ({ default: mockSql }));
vi.mock('../api/_lib/http.js', () => ({
  allowMethods: vi.fn(() => false),
  withErrors: (fn) => fn,
}));

process.env.DATABASE_URL = 'postgresql://test';

const handler = (await import('../api/version.js')).default;

function makeRes() {
  let statusCode = null;
  let body = null;
  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      body = data;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
}

describe('GET /api/version (SEC-18)', () => {
  beforeEach(() => {
    mockSql.mockReset();
  });

  it('devuelve un string hexadecimal opaco de 16 chars, no un epoch unix', async () => {
    // Simula un epoch unix típico (ms desde 1970)
    const epochMs = '1718400000000';
    mockSql.mockResolvedValueOnce([{ data_version: epochMs }]);

    const res = makeRes();
    await handler({ method: 'GET' }, res);

    const { dataVersion } = res.body;
    // Debe ser un string (no un número)
    expect(typeof dataVersion).toBe('string');
    // Debe tener exactamente 16 caracteres hex
    expect(dataVersion).toMatch(/^[0-9a-f]{16}$/);
    // NO debe ser el epoch crudo (ni como número ni como string)
    expect(dataVersion).not.toBe(epochMs);
    expect(dataVersion).not.toBe(String(Number(epochMs)));
  });

  it('es estable para el mismo input (hash determinista)', async () => {
    const epochMs = '1718400000000';
    mockSql.mockResolvedValueOnce([{ data_version: epochMs }]);
    const res1 = makeRes();
    await handler({ method: 'GET' }, res1);

    mockSql.mockResolvedValueOnce([{ data_version: epochMs }]);
    const res2 = makeRes();
    await handler({ method: 'GET' }, res2);

    expect(res1.body.dataVersion).toBe(res2.body.dataVersion);
  });

  it('cambia cuando cambia el epoch (detecta actualizaciones del catálogo)', async () => {
    mockSql.mockResolvedValueOnce([{ data_version: '1718400000000' }]);
    const res1 = makeRes();
    await handler({ method: 'GET' }, res1);

    mockSql.mockResolvedValueOnce([{ data_version: '1718400001000' }]);
    const res2 = makeRes();
    await handler({ method: 'GET' }, res2);

    expect(res1.body.dataVersion).not.toBe(res2.body.dataVersion);
  });
});
