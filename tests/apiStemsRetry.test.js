/**
 * apiStemsRetry.test.js — TDD para POST /api/stems/jobs/[id]/retry?section=<key>
 * Re-lanza una sola sección que falló sin tocar las demás.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks de storage ──────────────────────────────────────────────────────────
const mockCreateSignedUrl = vi.fn();
const mockCreateSignedUploadUrl = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: vi.fn() },
    storage: {
      from: () => ({
        createSignedUrl: mockCreateSignedUrl,
        createSignedUploadUrl: mockCreateSignedUploadUrl,
        list: vi.fn().mockResolvedValue({ data: [], error: null }),
        remove: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    },
  }),
}));

// ── Mock de sql ───────────────────────────────────────────────────────────────
const sqlResponses = [];
const sqlCalls = [];
function sqlMock(strings, ...values) {
  if (!strings?.raw) return strings; // passthrough para IN list
  sqlCalls.push({ text: strings.join('?').replace(/\s+/g, ' ').trim(), values });
  return Promise.resolve(sqlResponses.shift() ?? []);
}
sqlMock.json = (v) => v;
sqlMock.array = vi.fn((arr) => ({ __pgArray: arr }));
vi.mock('postgres', () => ({ default: () => sqlMock }));

// ── Mock de invokeModalPipeline ───────────────────────────────────────────────
const mockInvokeModalPipeline = vi.fn();
vi.mock('../api/_lib/modal.js', () => ({
  invokeModalPipeline: mockInvokeModalPipeline,
  verifyModalSignature: vi.fn(),
}));

// ── Env vars ──────────────────────────────────────────────────────────────────
process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
process.env.DATABASE_URL = 'postgresql://test';
process.env.MODAL_STEMS_ENDPOINT = 'https://modal.run/ep';
process.env.MODAL_INBOUND_SECRET = 'inbound';
process.env.MODAL_WEBHOOK_SECRET = 'whsecret';
process.env.PUBLIC_BASE_URL = 'https://hgmlyrics.vercel.app';

// Importar handler DESPUÉS de establecer mocks y env
const handler = (await import('../api/stems/jobs/[id]/retry.js')).default;

// ── Helpers ───────────────────────────────────────────────────────────────────
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

function authedReq(over = {}) {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer tok' },
    query: { id: 'job1', section: 'voiceInstrumental' },
    body: {},
    ...over,
  };
}

vi.mock('../api/_lib/auth.js', () => ({
  requireUser: async () => ({ id: 'u1', email: 'test@test.com' }),
}));

beforeEach(() => {
  sqlResponses.length = 0;
  sqlCalls.length = 0;
  sqlMock.array.mockClear();

  // createSignedUrl (GET) → devuelve una signed download URL
  mockCreateSignedUrl.mockReset().mockResolvedValue({
    data: { signedUrl: 'https://signed-download/input.mp3' },
    error: null,
  });

  // createSignedUploadUrl (PUT) → devuelve URLs distintas por key
  mockCreateSignedUploadUrl.mockReset().mockImplementation(async (key) => ({
    data: { signedUrl: `https://signed-put/${key}`, path: key, token: 'tok' },
    error: null,
  }));

  mockInvokeModalPipeline.mockReset().mockResolvedValue({ id: 'call_xyz' });

  // asegurar que MODAL_WEBHOOK_SECRET está presente para tests happy-path
  process.env.MODAL_WEBHOOK_SECRET = 'whsecret';
});

// ── Job stub ──────────────────────────────────────────────────────────────────
// Simula un job partial donde voiceInstrumental falló y el resto completó.
const jobWithFailedVI = () => ({
  id: 'job1',
  user_id: 'u1',
  status: 'partial',
  input_path: 'u1/job1/input/song.mp3',
  enabled_sections: ['voiceInstrumental', 'structure', 'leadBacking'],
  sections: {
    voiceInstrumental: {
      status: 'failed',
      model: null,
      error: 'timeout',
      enabled: true,
      outputs: { vocals: null, instrumental: null, drums: null, bass: null, guitar: null, piano: null, other: null },
    },
    structure: {
      status: 'done',
      model: 'allin1',
      error: null,
      segments: [{ start: 0, end: 10, label: 'verse' }],
    },
    leadBacking: {
      status: 'done',
      model: 'demucs',
      error: null,
      enabled: true,
      outputs: { lead: 'url1', backing: 'url2' },
    },
    gender: {
      status: 'skipped',
      model: null,
      error: null,
      enabled: false,
      outputs: { male: null, female: null },
    },
  },
});

// Job stub donde structure está en failed (sin outputs de audio)
const jobWithFailedStructure = () => ({
  ...jobWithFailedVI(),
  sections: {
    ...jobWithFailedVI().sections,
    voiceInstrumental: { ...jobWithFailedVI().sections.voiceInstrumental, status: 'done' },
    structure: {
      status: 'failed',
      model: null,
      error: 'allin1 crash',
      segments: [],
    },
  },
});

describe('POST /api/stems/jobs/[id]/retry — DAG retry flow', () => {
  it('400 si section no es una key válida (no toca DB ni modal)', async () => {
    const res = makeRes();
    await handler(authedReq({ query: { id: 'job1', section: 'noExiste' } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toBeTruthy();
    expect(sqlCalls.length).toBe(0);
    expect(mockInvokeModalPipeline).not.toHaveBeenCalled();
  });

  it('404 si el job no existe', async () => {
    sqlResponses.push([]); // SELECT → vacío
    const res = makeRes();
    await handler(authedReq(), res);
    expect(res.statusCode).toBe(404);
    expect(mockInvokeModalPipeline).not.toHaveBeenCalled();
  });

  it('409 si la sección objetivo no está en failed (status done)', async () => {
    const job = jobWithFailedVI();
    job.sections.voiceInstrumental.status = 'done';
    sqlResponses.push([job]);
    const res = makeRes();
    await handler(authedReq(), res);
    expect(res.statusCode).toBe(409);
    expect(mockInvokeModalPipeline).not.toHaveBeenCalled();
  });

  it('409 si la sección objetivo está skipped (no se puede reintentar)', async () => {
    sqlResponses.push([jobWithFailedVI()]);
    const res = makeRes();
    await handler(authedReq({ query: { id: 'job1', section: 'gender' } }), res);
    expect(res.statusCode).toBe(409);
    expect(mockInvokeModalPipeline).not.toHaveBeenCalled();
  });

  it('happy path voiceInstrumental failed: 200, UPDATE a processing, sección pasa a running, otras intactas', async () => {
    sqlResponses.push([jobWithFailedVI()]); // SELECT
    sqlResponses.push([]); // UPDATE a processing
    const res = makeRes();
    await handler(authedReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });

    // Debe haber un UPDATE con status='processing'
    const updateCall = sqlCalls.find(
      (c) => c.text.includes('processing') && c.text.includes('stem_jobs'),
    );
    expect(updateCall).toBeTruthy();

    // El objeto sections pasado al UPDATE debe tener voiceInstrumental=running
    const sectionsArg = updateCall.values.find(
      (v) => v && typeof v === 'object' && 'voiceInstrumental' in v,
    );
    expect(sectionsArg).toBeTruthy();
    expect(sectionsArg.voiceInstrumental.status).toBe('running');
    expect(sectionsArg.voiceInstrumental.error).toBeNull();

    // Las otras secciones deben estar intactas
    expect(sectionsArg.structure.status).toBe('done');
    expect(sectionsArg.leadBacking.status).toBe('done');
    expect(sectionsArg.gender.status).toBe('skipped');
  });

  it('happy path voiceInstrumental: invokeModalPipeline llamado 1 vez con enabledSections y uploads correctos', async () => {
    sqlResponses.push([jobWithFailedVI()]);
    sqlResponses.push([]);
    await handler(authedReq(), makeRes());

    expect(mockInvokeModalPipeline).toHaveBeenCalledTimes(1);
    const payload = mockInvokeModalPipeline.mock.calls[0][0];

    expect(payload.jobId).toBe('job1');
    expect(payload.input.getUrl).toBe('https://signed-download/input.mp3');
    expect(payload.enabledSections).toEqual(['voiceInstrumental']);
    expect(payload.webhook.url).toContain('/api/stems/webhook');
    expect(payload.webhook.secret).toBe('whsecret');

    // Las 7 pistas de voiceInstrumental deben tener URLs firmadas
    const vi_uploads = payload.uploads.voiceInstrumental;
    expect(vi_uploads).toBeDefined();
    for (const track of ['vocals', 'instrumental', 'drums', 'bass', 'guitar', 'piano', 'other']) {
      expect(vi_uploads[track]).toMatch(/^https:\/\/signed-put\//);
      expect(vi_uploads[track]).toContain('voiceInstrumental');
      expect(vi_uploads[track]).toContain(track);
    }
  });

  it('happy path structure failed: uploads.structure es {} y enabledSections es [structure]', async () => {
    sqlResponses.push([jobWithFailedStructure()]); // SELECT
    sqlResponses.push([]); // UPDATE
    const res = makeRes();
    await handler(authedReq({ query: { id: 'job1', section: 'structure' } }), res);

    expect(res.statusCode).toBe(200);
    expect(mockInvokeModalPipeline).toHaveBeenCalledTimes(1);
    const payload = mockInvokeModalPipeline.mock.calls[0][0];
    expect(payload.enabledSections).toEqual(['structure']);
    expect(payload.uploads.structure).toEqual({});
  });

  it('400 si signStemsDownload lanza (input no disponible) → no invoca modal', async () => {
    sqlResponses.push([jobWithFailedVI()]);
    mockCreateSignedUrl.mockResolvedValueOnce({ data: null, error: new Error('not found') });

    const res = makeRes();
    await handler(authedReq(), res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/no está disponible/i);
    expect(mockInvokeModalPipeline).not.toHaveBeenCalled();
  });

  it('error de modal: UPDATE revierte sección a failed con error y status >= 500', async () => {
    sqlResponses.push([jobWithFailedVI()]); // SELECT
    sqlResponses.push([]); // UPDATE a processing
    sqlResponses.push([]); // UPDATE revertida a failed

    const modalError = new Error('Modal 502: timeout');
    mockInvokeModalPipeline.mockRejectedValueOnce(modalError);

    const res = makeRes();
    await handler(authedReq(), res);

    // Debe haber un UPDATE de reversión que actualice la columna error del job.
    // El status revertido lo calcula deriveJobStatus (puede ser 'partial' si otras secciones
    // están done), así que buscamos el UPDATE que incluye la columna error = ...
    const revertCall = sqlCalls.find(
      (c) => c.text.includes('error') && c.text.includes('stem_jobs') && c.text.includes('UPDATE'),
    );
    expect(revertCall).toBeTruthy();

    // El mensaje de error debe aparecer en los valores
    const errorValue = revertCall.values.find(
      (v) => typeof v === 'string' && v.includes('Modal 502'),
    );
    expect(errorValue).toBeTruthy();

    // El objeto sections revertido debe tener voiceInstrumental de vuelta en failed
    const sectionsReverted = revertCall.values.find(
      (v) => v && typeof v === 'object' && 'voiceInstrumental' in v,
    );
    expect(sectionsReverted).toBeTruthy();
    expect(sectionsReverted.voiceInstrumental.status).toBe('failed');

    expect(res.statusCode).toBeGreaterThanOrEqual(500);
  });

  it('500 si MODAL_WEBHOOK_SECRET no está configurado', async () => {
    delete process.env.MODAL_WEBHOOK_SECRET;

    const res = makeRes();
    await handler(authedReq(), res);

    expect(res.statusCode).toBe(500);
    expect(mockInvokeModalPipeline).not.toHaveBeenCalled();
  });
});
