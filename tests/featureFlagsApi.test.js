import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
// sql mock: tagged-template fn callable también como sql(rows) para inserts
// multi-fila (postgres.js). Por defecto resuelve { count: 1 } (usado por
// UPDATE/DELETE para detectar 404 via result.count).
const mockSql = vi.fn(async () => ({ count: 1 }));
vi.mock('../api/_lib/db.js', () => ({ default: mockSql }));

vi.mock('../api/_lib/auth.js', () => ({
  requireAdmin: vi.fn(async () => {}),
}));
vi.mock('../api/_lib/http.js', () => ({
  allowMethods: vi.fn(() => false),
  withErrors: (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      const status = e?.status ?? 500;
      res.status(status).json({ error: e?.message ?? 'Error' });
    }
  },
}));

const invalidateFlags = vi.fn();
vi.mock('../api/_lib/flagsCache.js', () => ({ invalidateFlags }));

function makeRes() {
  const res = { _status: 200, _body: null };
  res.status = (s) => {
    res._status = s;
    return res;
  };
  res.json = (b) => {
    res._body = b;
    return res;
  };
  return res;
}

function callsFor(sqlText) {
  return mockSql.mock.calls.filter(
    (args) =>
      Array.isArray(args[0]) &&
      args[0].raw &&
      args[0].some((s) => typeof s === 'string' && s.includes(sqlText)),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSql.mockResolvedValue({ count: 1 });
});

const handler = (await import('../api/admin/feature-flags.js')).default;

function makeReq(method, body) {
  return { method, query: {}, body };
}

describe('POST feature-flags action:create', () => {
  it('key válida: inserta y responde 200', async () => {
    const req = makeReq('POST', { action: 'create', key: 'voz_tono', description: 'Modo voz' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(callsFor('INSERT INTO feature_flags')).toHaveLength(1);
    expect(invalidateFlags).toHaveBeenCalledTimes(1);
  });

  it.each([['Flag!'], [''], ['a'.repeat(51)], ['MAYUSCULA']])(
    'key inválida "%s": 400, sin insertar',
    async (key) => {
      const req = makeReq('POST', { action: 'create', key, description: 'x' });
      const res = makeRes();
      await handler(req, res);
      expect(res._status).toBe(400);
      expect(callsFor('INSERT INTO feature_flags')).toHaveLength(0);
    },
  );

  it('key duplicada: 409 (sql lanza error code 23505)', async () => {
    mockSql.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
      }),
    );
    const req = makeReq('POST', { action: 'create', key: 'voz_tono', description: 'x' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(409);
    expect(res._body.error).toBe('La flag ya existe');
    expect(invalidateFlags).not.toHaveBeenCalled();
  });

  it('propaga errores que no son de clave duplicada', async () => {
    mockSql.mockRejectedValueOnce(Object.assign(new Error('otro error'), { code: 'XX000' }));
    const req = makeReq('POST', { action: 'create', key: 'voz_tono', description: 'x' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(500);
  });
});

describe('POST feature-flags action:toggle-global', () => {
  it('actualiza enabled_global y responde 200', async () => {
    const req = makeReq('POST', { action: 'toggle-global', key: 'voz_tono', enabled: true });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(callsFor('UPDATE feature_flags')).toHaveLength(1);
    expect(invalidateFlags).toHaveBeenCalledTimes(1);
  });

  it('key inexistente (count 0): 404', async () => {
    mockSql.mockResolvedValueOnce({ count: 0 });
    const req = makeReq('POST', { action: 'toggle-global', key: 'no_existe', enabled: false });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(404);
    expect(invalidateFlags).not.toHaveBeenCalled();
  });
});

describe('POST feature-flags action:assign', () => {
  it('users válidos: un único INSERT multi-fila, 200', async () => {
    const req = makeReq('POST', {
      action: 'assign',
      key: 'voz_tono',
      users: [{ username: 'a' }, { email: 'b@c.d' }],
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(callsFor('INSERT INTO feature_flag_users')).toHaveLength(1);
    expect(invalidateFlags).toHaveBeenCalledTimes(1);
  });

  it('users vacío: 400', async () => {
    const req = makeReq('POST', { action: 'assign', key: 'voz_tono', users: [] });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(callsFor('INSERT INTO feature_flag_users')).toHaveLength(0);
  });

  it('users > 100: 400', async () => {
    const users = Array.from({ length: 101 }, (_, i) => ({ username: `u${i}` }));
    const req = makeReq('POST', { action: 'assign', key: 'voz_tono', users });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(callsFor('INSERT INTO feature_flag_users')).toHaveLength(0);
  });

  it('usuario sin email ni username: 400', async () => {
    const req = makeReq('POST', { action: 'assign', key: 'voz_tono', users: [{}] });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(callsFor('INSERT INTO feature_flag_users')).toHaveLength(0);
  });
});

describe('POST feature-flags sin action (contrato actual)', () => {
  it('flagKey + username: agrega asignación individual', async () => {
    const req = makeReq('POST', { flagKey: 'voz_tono', username: 'samu' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(callsFor('INSERT INTO feature_flag_users')).toHaveLength(1);
    expect(invalidateFlags).toHaveBeenCalledTimes(1);
  });
});

describe('DELETE feature-flags action:flag', () => {
  it('borra del catálogo y responde 200', async () => {
    const req = makeReq('DELETE', { action: 'flag', key: 'voz_tono' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(callsFor('DELETE FROM feature_flags')).toHaveLength(1);
    expect(invalidateFlags).toHaveBeenCalledTimes(1);
  });

  it('key inexistente (count 0): 404', async () => {
    mockSql.mockResolvedValueOnce({ count: 0 });
    const req = makeReq('DELETE', { action: 'flag', key: 'no_existe' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(404);
    expect(invalidateFlags).not.toHaveBeenCalled();
  });
});

describe('DELETE feature-flags sin action (contrato actual)', () => {
  it('flagKey + username: quita asignación', async () => {
    const req = makeReq('DELETE', { flagKey: 'voz_tono', username: 'samu' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(callsFor('DELETE FROM feature_flag_users')).toHaveLength(1);
    expect(invalidateFlags).toHaveBeenCalledTimes(1);
  });
});
