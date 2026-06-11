import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: vi.fn() },
    storage: {
      from: () => ({
        createSignedUrl: vi.fn(),
        upload: vi.fn(),
        createSignedUploadUrl: vi.fn(),
      }),
    },
  }),
}));

const sqlResponses = [];
const sqlCalls = [];
function sqlMock(strings, ...values) {
  if (!strings.raw) return strings; // sql(array) para IN list
  sqlCalls.push({ text: strings.join('?').replace(/\s+/g, ' ').trim(), values });
  return Promise.resolve(sqlResponses.shift() ?? []);
}
sqlMock.json = (v) => v;
vi.mock('postgres', () => ({ default: () => sqlMock }));

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
process.env.DATABASE_URL = 'postgresql://test';
process.env.PUBLIC_BASE_URL = 'https://hgmlyrics.vercel.app';
process.env.MODAL_WEBHOOK_SECRET = 'modalwebhooksecret';

const handler = (await import('../api/stems/webhook.js')).default;

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
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

beforeEach(() => {
  sqlResponses.length = 0;
  sqlCalls.length = 0;
  sqlMock.begin = undefined;
});

function modalSectionReq(bodyObj) {
  const body = JSON.stringify(bodyObj);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', 'modalwebhooksecret')
    .update(`${timestamp}.${body}`)
    .digest('hex');
  const req = Readable.from([Buffer.from(body)]);
  req.method = 'POST';
  req.headers = { 'x-modal-timestamp': timestamp, 'x-modal-signature': sig };
  req.query = {};
  req.url = '/api/stems/webhook';
  return req;
}

// sql mock con begin() para las transacciones FOR UPDATE de applySectionWebhook
function setupSqlBegin({ sections, status = 'processing' } = {}) {
  sqlResponses.length = 0;
  sqlCalls.length = 0;

  sqlMock.begin = async (cb) => {
    const innerSql = (strings, ...values) => {
      if (!strings?.raw) return strings;
      sqlCalls.push({ text: strings.join('?').replace(/\s+/g, ' ').trim(), values });
      return Promise.resolve(sqlResponses.shift() ?? []);
    };
    innerSql.json = (v) => v;
    return cb(innerSql);
  };

  if (sections !== null) {
    sqlResponses.push([{ sections, status }]); // SELECT FOR UPDATE
    sqlResponses.push([]);                      // UPDATE stem_jobs SET sections = ...
  } else {
    sqlResponses.push([]);                      // job desconocido
  }
}

describe('POST /api/stems/webhook — firma HMAC', () => {
  it('401 si la firma Modal es inválida', async () => {
    const body = JSON.stringify({ jobId: 'j1', section: 'structure', result: { status: 'done' } });
    const req = Readable.from([Buffer.from(body)]);
    req.method = 'POST';
    req.headers = {
      'x-modal-timestamp': String(Math.floor(Date.now() / 1000)),
      'x-modal-signature': 'deadbeef',
    };
    req.query = {};
    req.url = '/api/stems/webhook';
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('401 si el timestamp está fuera de la tolerancia (anti-replay)', async () => {
    const body = JSON.stringify({ jobId: 'j1', section: 'structure', result: { status: 'done' } });
    const oldTs = String(Math.floor(Date.now() / 1000) - 10 * 60);
    const sig = createHmac('sha256', 'modalwebhooksecret')
      .update(`${oldTs}.${body}`)
      .digest('hex');
    const req = Readable.from([Buffer.from(body)]);
    req.method = 'POST';
    req.headers = { 'x-modal-timestamp': oldTs, 'x-modal-signature': sig };
    req.query = {};
    req.url = '/api/stems/webhook';
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/stems/webhook — validación payload', () => {
  it('400 si falta jobId', async () => {
    const res = makeRes();
    await handler(modalSectionReq({ section: 'structure', result: { status: 'done' } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('400 si falta section', async () => {
    const res = makeRes();
    await handler(modalSectionReq({ jobId: 'j1', result: { status: 'done' } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('400 si section no es válida', async () => {
    const res = makeRes();
    await handler(
      modalSectionReq({ jobId: 'j1', section: 'SECCION_INVALIDA', result: { status: 'done' } }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/stems/webhook — contrato per-sección DAG', () => {
  it('404 si el job no existe', async () => {
    setupSqlBegin({ sections: null });
    const res = makeRes();
    await handler(
      modalSectionReq({ jobId: 'j1', section: 'structure', result: { status: 'done', segments: [] } }),
      res,
    );
    expect(res.statusCode).toBe(404);
  });

  it('done en structure → 200 con status processing (otras secciones pendientes)', async () => {
    const { initSections } = await import('../api/stems/_sections.js');
    const sections = initSections(['voiceInstrumental', 'structure', 'leadBacking']);
    setupSqlBegin({ sections, status: 'processing' });

    const res = makeRes();
    await handler(
      modalSectionReq({
        jobId: 'j1',
        section: 'structure',
        result: { status: 'done', model: 'allin1', segments: [{ start: 0, end: 4, label: 'verse' }] },
      }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('processing');
    expect(sqlCalls.some((c) => c.text.includes('FOR UPDATE'))).toBe(true);
  });

  it('failed en una sección con las demás done → 200 con status partial', async () => {
    const { initSections, applySectionResult } = await import('../api/stems/_sections.js');
    let sections = initSections(['voiceInstrumental', 'structure']);
    sections = applySectionResult(sections, 'structure', { status: 'done', model: 'allin1', segments: [] });
    setupSqlBegin({ sections, status: 'processing' });

    const res = makeRes();
    await handler(
      modalSectionReq({
        jobId: 'j1',
        section: 'voiceInstrumental',
        result: { status: 'failed', model: 'htdemucs', error: 'OOM' },
      }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('partial');
  });
});
