import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';

const mockCreateSignedUrl = vi.fn();
const mockUpload = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: vi.fn() },
    storage: {
      from: () => ({
        createSignedUrl: mockCreateSignedUrl,
        upload: mockUpload,
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
process.env.REPLICATE_API_TOKEN = 'r8_x';
process.env.PUBLIC_BASE_URL = 'https://hgmlyrics.vercel.app';
const SECRET = 'whsec_' + Buffer.from('k').toString('base64');
process.env.REPLICATE_WEBHOOK_SECRET = SECRET;

const handler = (await import('../api/stems/webhook.js')).default;

function signedReq(bodyObj, { job = 'j1', kind = 'stems' } = {}) {
  const body = JSON.stringify(bodyObj);
  const id = 'msg_1';
  const timestamp = '1718000000';
  const key = Buffer.from(SECRET.split('_')[1], 'base64');
  const sig = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  const req = Readable.from([Buffer.from(body)]);
  req.method = 'POST';
  req.headers = {
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${sig}`,
  };
  req.query = { job, kind };
  req.url = `/api/stems/webhook?job=${job}&kind=${kind}`;
  return req;
}

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
  mockUpload.mockReset().mockResolvedValue({ data: {}, error: null });
  mockCreateSignedUrl
    .mockReset()
    .mockResolvedValue({ data: { signedUrl: 'https://signed/x' }, error: null });
  global.fetch = vi.fn();
});

describe('POST /api/stems/webhook', () => {
  it('401 si la firma es inválida', async () => {
    const req = signedReq({ status: 'succeeded' });
    req.headers['webhook-signature'] = 'v1,AAAA';
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('404 si el job no existe', async () => {
    sqlResponses.push([]); // SELECT job
    const res = makeRes();
    await handler(signedReq({ status: 'succeeded' }), res);
    expect(res.statusCode).toBe(404);
  });

  it('marca failed cuando la predicción falla', async () => {
    sqlResponses.push([{ id: 'j1', user_id: 'u1', status: 'separating_stems', voices: null }]);
    sqlResponses.push([]); // UPDATE failed
    const res = makeRes();
    await handler(signedReq({ status: 'failed', error: 'boom' }), res);
    expect(res.statusCode).toBe(200);
    expect(sqlCalls.some((c) => c.text.includes("status = 'failed'"))).toBe(true);
  });

  it('stems OK: copia outputs, lanza etapa 2 y pasa a separating_voices', async () => {
    sqlResponses.push([{ id: 'j1', user_id: 'u1', status: 'separating_stems', voices: null }]);
    sqlResponses.push([]); // UPDATE a separating_voices
    // fetch: 6 descargas de stems + 2 createPrediction
    fetch.mockImplementation(async (url) => {
      if (String(url).includes('api.replicate.com')) {
        return { ok: true, json: async () => ({ id: 'pred_x' }) };
      }
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(4),
        headers: { get: () => 'audio/wav' },
      };
    });
    const output = {
      vocals: 'https://r/v.wav',
      drums: 'https://r/d.wav',
      bass: 'https://r/b.wav',
      guitar: 'https://r/g.wav',
      piano: 'https://r/p.wav',
      other: 'https://r/o.wav',
    };
    const res = makeRes();
    await handler(signedReq({ status: 'succeeded', output }), res);
    expect(res.statusCode).toBe(200);
    expect(mockUpload).toHaveBeenCalledTimes(6);
    const replicateCalls = fetch.mock.calls.filter((c) =>
      String(c[0]).includes('api.replicate.com'),
    );
    expect(replicateCalls).toHaveLength(2); // karaoke + diarization
    expect(sqlCalls.some((c) => c.text.includes("status = 'separating_voices'"))).toBe(true);
  });

  it('etapa 2 completa (karaoke y diarización) → done', async () => {
    // Llega diarización cuando karaoke ya está en voices
    sqlResponses.push([
      {
        id: 'j1',
        user_id: 'u1',
        status: 'separating_voices',
        voices: { lead: 'l.wav', backing: 'b.wav' },
      },
    ]);
    sqlResponses.push([]); // UPDATE done
    const output = { segments: [{ speaker: 'SPEAKER_00', start: 1.5, end: 4.2 }] };
    const res = makeRes();
    await handler(signedReq({ status: 'succeeded', output }, { kind: 'diarization' }), res);
    expect(res.statusCode).toBe(200);
    expect(sqlCalls.some((c) => c.text.includes("status = 'done'"))).toBe(true);
  });
});
