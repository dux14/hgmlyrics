/**
 * apiStemsStart.test.js — TDD para POST /api/stems/jobs/[id]/start
 * Fase 0 DAG: inicializa secciones, pre-firma URLs de upload/download, invoca run_pipeline.
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
// sql.array: espía para poder verificar que se invoca con el arreglo correcto.
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
const handler = (await import('../api/stems/jobs/[id]/start.js')).default;

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
    query: { id: 'job1' },
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

  // createSignedUrl (GET) → siempre devuelve una signed download URL
  mockCreateSignedUrl.mockReset().mockResolvedValue({
    data: { signedUrl: 'https://signed-download/input.mp3' },
    error: null,
  });

  // createSignedUploadUrl (PUT) → devuelve URLs distintas por llamada para poder verificar
  mockCreateSignedUploadUrl.mockReset().mockImplementation(async (key) => ({
    data: { signedUrl: `https://signed-put/${key}`, path: key, token: 'tok' },
    error: null,
  }));

  mockInvokeModalPipeline.mockReset().mockResolvedValue({ id: 'call_xyz' });

  // reset gender flag
  delete process.env.STUDIO_GENDER_FLAG;

  // asegurar que MODAL_WEBHOOK_SECRET está presente para tests happy-path
  process.env.MODAL_WEBHOOK_SECRET = 'whsecret';
});

// ── Job stub ──────────────────────────────────────────────────────────────────
const jobCreated = () => ({
  id: 'job1',
  user_id: 'u1',
  status: 'created',
  input_path: 'u1/job1/input/song.mp3',
});

describe('POST /api/stems/jobs/[id]/start — DAG flow', () => {
  it('404 si el job no existe', async () => {
    sqlResponses.push([]); // SELECT → vacío
    const res = makeRes();
    await handler(authedReq(), res);
    expect(res.statusCode).toBe(404);
    expect(mockInvokeModalPipeline).not.toHaveBeenCalled();
  });

  it('409 si el job ya no está en estado created', async () => {
    sqlResponses.push([{ ...jobCreated(), status: 'processing' }]);
    const res = makeRes();
    await handler(authedReq(), res);
    expect(res.statusCode).toBe(409);
    expect(mockInvokeModalPipeline).not.toHaveBeenCalled();
  });

  it('actualiza el job a status=processing con sections inicializadas (sin gender)', async () => {
    sqlResponses.push([jobCreated()]); // SELECT job
    sqlResponses.push([]); // UPDATE job

    const res = makeRes();
    await handler(authedReq(), res);

    expect(res.statusCode).toBe(200);

    // Verificar UPDATE a 'processing'
    const updateCall = sqlCalls.find(
      (c) => c.text.includes('processing') && c.text.includes('stem_jobs'),
    );
    expect(updateCall).toBeTruthy();

    // Las 4 secciones deben estar presentes en el objeto que se persiste
    const sectionsArg = updateCall.values.find(
      (v) => v && typeof v === 'object' && 'voiceInstrumental' in v,
    );
    expect(sectionsArg).toBeTruthy();
    expect(sectionsArg).toHaveProperty('voiceInstrumental');
    expect(sectionsArg).toHaveProperty('leadBacking');
    expect(sectionsArg).toHaveProperty('gender');
    expect(sectionsArg).toHaveProperty('structure');

    // voiceInstrumental y leadBacking → pending; gender → skipped (flag off)
    expect(sectionsArg.voiceInstrumental.status).toBe('pending');
    expect(sectionsArg.leadBacking.status).toBe('pending');
    expect(sectionsArg.structure.status).toBe('pending');
    expect(sectionsArg.gender.status).toBe('skipped');
  });

  it('usa sql.array() para serializar enabled_sections en el UPDATE de processing', async () => {
    sqlResponses.push([jobCreated()]);
    sqlResponses.push([]);

    await handler(authedReq(), makeRes());

    // sql.array debe haberse invocado con el arreglo de secciones habilitadas.
    expect(sqlMock.array).toHaveBeenCalledTimes(1);
    const arg = sqlMock.array.mock.calls[0][0];
    expect(Array.isArray(arg)).toBe(true);
    expect(arg).toContain('voiceInstrumental');
    expect(arg).toContain('structure');
    expect(arg).toContain('leadBacking');
    // gender no habilitado (flag off)
    expect(arg).not.toContain('gender');

    // El valor resultante (__pgArray wrapper) debe aparecer en los valores del UPDATE.
    const updateCall = sqlCalls.find(
      (c) => c.text.includes('processing') && c.text.includes('stem_jobs'),
    );
    const arrayValue = updateCall.values.find((v) => v && v.__pgArray);
    expect(arrayValue).toBeDefined();
    // nota: la serialización real a wire-format text[] de Postgres ("{"a","b"}) se ejerce
    // en integración; aquí verificamos que el wrapper de sql.array fue pasado correctamente.
  });

  it('invoca invokeModalPipeline una sola vez con run_pipeline y payload correcto', async () => {
    sqlResponses.push([jobCreated()]);
    sqlResponses.push([]);

    await handler(authedReq(), makeRes());

    expect(mockInvokeModalPipeline).toHaveBeenCalledTimes(1);
    const payload = mockInvokeModalPipeline.mock.calls[0][0];

    expect(payload.jobId).toBe('job1');
    expect(payload.input.getUrl).toBe('https://signed-download/input.mp3');
    expect(payload.enabledSections).toContain('voiceInstrumental');
    expect(payload.enabledSections).toContain('structure');
    expect(payload.enabledSections).toContain('leadBacking');
    expect(payload.enabledSections).not.toContain('gender');
    expect(payload.webhook.url).toContain('/api/stems/webhook');
    expect(payload.webhook.secret).toBe('whsecret');
  });

  it('payload.uploads.voiceInstrumental tiene las 7 pistas firmadas', async () => {
    sqlResponses.push([jobCreated()]);
    sqlResponses.push([]);

    await handler(authedReq(), makeRes());

    const payload = mockInvokeModalPipeline.mock.calls[0][0];
    const vi_uploads = payload.uploads.voiceInstrumental;

    expect(vi_uploads).toBeDefined();
    for (const track of ['vocals', 'instrumental', 'drums', 'bass', 'guitar', 'piano', 'other']) {
      expect(vi_uploads[track]).toMatch(/^https:\/\/signed-put\//);
      // La key de storage debe incluir el section y el track name
      expect(vi_uploads[track]).toContain('voiceInstrumental');
      expect(vi_uploads[track]).toContain(track);
    }
  });

  it('payload.uploads.leadBacking tiene lead y backing', async () => {
    sqlResponses.push([jobCreated()]);
    sqlResponses.push([]);

    await handler(authedReq(), makeRes());

    const payload = mockInvokeModalPipeline.mock.calls[0][0];
    expect(payload.uploads.leadBacking.lead).toMatch(/^https:\/\/signed-put\//);
    expect(payload.uploads.leadBacking.backing).toMatch(/^https:\/\/signed-put\//);
  });

  it('structure no tiene uploads (no genera audio)', async () => {
    sqlResponses.push([jobCreated()]);
    sqlResponses.push([]);

    await handler(authedReq(), makeRes());

    const payload = mockInvokeModalPipeline.mock.calls[0][0];
    // structure está en enabledSections pero sin uploads de audio
    expect(payload.uploads.structure).toEqual({});
  });

  it('con STUDIO_GENDER_FLAG=on incluye gender en enabledSections y uploads', async () => {
    process.env.STUDIO_GENDER_FLAG = 'on';
    sqlResponses.push([jobCreated()]);
    sqlResponses.push([]);

    await handler(authedReq(), makeRes());

    const payload = mockInvokeModalPipeline.mock.calls[0][0];
    expect(payload.enabledSections).toContain('gender');
    expect(payload.uploads.gender.male).toMatch(/^https:\/\/signed-put\//);
    expect(payload.uploads.gender.female).toMatch(/^https:\/\/signed-put\//);

    // Las sections deben tener gender=pending
    const updateCall = sqlCalls.find(
      (c) => c.text.includes('processing') && c.text.includes('stem_jobs'),
    );
    const sectionsArg = updateCall.values.find((v) => v && typeof v === 'object' && 'gender' in v);
    expect(sectionsArg.gender.status).toBe('pending');
  });

  it('400 si el input_path no existe en storage (signStemsDownload lanza)', async () => {
    sqlResponses.push([jobCreated()]);
    mockCreateSignedUrl.mockResolvedValueOnce({ data: null, error: new Error('not found') });

    const res = makeRes();
    await handler(authedReq(), res);
    expect(res.statusCode).toBe(400);
    expect(mockInvokeModalPipeline).not.toHaveBeenCalled();
  });

  it('marca el job como failed y relanza si invokeModalPipeline rechaza', async () => {
    sqlResponses.push([jobCreated()]); // SELECT
    sqlResponses.push([]); // UPDATE a processing
    sqlResponses.push([]); // UPDATE a failed

    const modalError = new Error('Modal 502: timeout');
    mockInvokeModalPipeline.mockRejectedValueOnce(modalError);

    const res = makeRes();
    // withErrors captura el relanzamiento y devuelve 500
    await handler(authedReq(), res);

    // Debe haber habido un UPDATE a 'failed'
    const failedUpdate = sqlCalls.find(
      (c) => c.text.includes('failed') && c.text.includes('stem_jobs'),
    );
    expect(failedUpdate).toBeTruthy();
    // El mensaje de error debe estar en los valores
    const errorValue = failedUpdate.values.find(
      (v) => typeof v === 'string' && v.includes('Modal 502'),
    );
    expect(errorValue).toBeTruthy();

    // El handler aún debe haber terminado con un error (5xx via withErrors)
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
  });

  it('500 si MODAL_WEBHOOK_SECRET no está configurado', async () => {
    delete process.env.MODAL_WEBHOOK_SECRET;
    // No necesitamos sqlResponses porque el guard lanza antes de tocar la DB.

    const res = makeRes();
    await handler(authedReq(), res);

    expect(res.statusCode).toBe(500);
    expect(mockInvokeModalPipeline).not.toHaveBeenCalled();
  });
});
