/**
 * apiStemsJobsId.test.js — TDD para GET /api/stems/jobs/[id]
 * Verifica aplanado de outputs firmados (done/partial) y paso en crudo (processing).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock de @supabase/supabase-js (necesario para que db.js importe) ──────────
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: vi.fn() },
    storage: {
      from: () => ({
        createSignedUrl: vi
          .fn()
          .mockResolvedValue({ data: { signedUrl: 'https://x' }, error: null }),
        createSignedUploadUrl: vi.fn(),
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
  if (!strings?.raw) return strings;
  sqlCalls.push({ text: strings.join('?').replace(/\s+/g, ' ').trim(), values });
  return Promise.resolve(sqlResponses.shift() ?? []);
}
sqlMock.json = (v) => v;
sqlMock.array = vi.fn((arr) => ({ __pgArray: arr }));
vi.mock('postgres', () => ({ default: () => sqlMock }));

// ── Mocks de helpers propios ──────────────────────────────────────────────────
vi.mock('../api/_lib/auth.js', () => ({
  requireUser: vi.fn(),
}));

vi.mock('../api/_lib/storage.js', () => ({
  signStemsDownload: vi.fn((key) => Promise.resolve('signed://' + key)),
}));

// ── Env vars ──────────────────────────────────────────────────────────────────
process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
process.env.DATABASE_URL = 'postgresql://test';

// Importar handler DESPUÉS de establecer mocks y env
const handler = (await import('../api/stems/jobs/[id].js')).default;

const { requireUser } = await import('../api/_lib/auth.js');
const { signStemsDownload } = await import('../api/_lib/storage.js');

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
    method: 'GET',
    headers: { authorization: 'Bearer tok' },
    query: { id: 'j1' },
    body: {},
    ...over,
  };
}

beforeEach(() => {
  sqlResponses.length = 0;
  sqlCalls.length = 0;
  sqlMock.array.mockClear();
  requireUser.mockClear().mockResolvedValue({ id: 'u1' });
  signStemsDownload.mockClear().mockImplementation((key) => Promise.resolve('signed://' + key));
});

describe('GET /api/stems/jobs/[id]', () => {
  it('404 cuando el SELECT devuelve fila vacía', async () => {
    sqlResponses.push([]); // SELECT → sin resultados
    const res = makeRes();
    await handler(authedReq(), res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Job no encontrado' });
  });

  it('done: aplana y firma outputs; omite valores nulos', async () => {
    const job = {
      id: 'j1',
      user_id: 'u1',
      status: 'done',
      sections: {
        voiceInstrumental: {
          outputs: {
            vocals: 'u1/j1/voiceInstrumental/vocals.mp3',
            instrumental: 'u1/j1/voiceInstrumental/instrumental.mp3',
            drums: null,
          },
        },
        leadBacking: {
          outputs: {
            lead: 'u1/j1/leadBacking/lead.mp3',
            backing: null,
          },
        },
      },
    };
    sqlResponses.push([job]);
    const res = makeRes();
    await handler(authedReq(), res);

    expect(res.statusCode).toBe(200);
    const { job: result } = res.body;

    // stems firmados
    expect(result.stems.vocals).toBe('signed://u1/j1/voiceInstrumental/vocals.mp3');
    expect(result.stems.instrumental).toBe('signed://u1/j1/voiceInstrumental/instrumental.mp3');
    // null se omite
    expect(result.stems.drums).toBeUndefined();

    // voices firmados
    expect(result.voices.lead).toBe('signed://u1/j1/leadBacking/lead.mp3');
    // null se omite
    expect(result.voices.backing).toBeUndefined();

    // signStemsDownload llamado solo para los no nulos (vocals, instrumental, lead)
    expect(signStemsDownload).toHaveBeenCalledTimes(3);
    expect(signStemsDownload).toHaveBeenCalledWith('u1/j1/voiceInstrumental/vocals.mp3');
    expect(signStemsDownload).toHaveBeenCalledWith('u1/j1/voiceInstrumental/instrumental.mp3');
    expect(signStemsDownload).toHaveBeenCalledWith('u1/j1/leadBacking/lead.mp3');
  });

  it('partial también aplana y firma los outputs disponibles', async () => {
    const job = {
      id: 'j1',
      user_id: 'u1',
      status: 'partial',
      sections: {
        voiceInstrumental: {
          outputs: {
            vocals: 'u1/j1/voiceInstrumental/vocals.mp3',
          },
        },
        leadBacking: {
          outputs: {},
        },
      },
    };
    sqlResponses.push([job]);
    const res = makeRes();
    await handler(authedReq(), res);

    expect(res.statusCode).toBe(200);
    const { job: result } = res.body;

    expect(result.stems.vocals).toBe('signed://u1/j1/voiceInstrumental/vocals.mp3');
    expect(signStemsDownload).toHaveBeenCalledTimes(1);
    expect(signStemsDownload).toHaveBeenCalledWith('u1/j1/voiceInstrumental/vocals.mp3');
  });

  it('done con gender: genderVoices anidado tiene URLs firmadas por modelo y track', async () => {
    const job = {
      id: 'j1',
      user_id: 'u1',
      status: 'done',
      sections: {
        voiceInstrumental: { outputs: {} },
        leadBacking: { outputs: {} },
        gender: {
          status: 'done',
          outputs: {
            chorus: {
              male: 'u1/j1/gender/chorus/male.mp3',
              female: 'u1/j1/gender/chorus/female.mp3',
            },
            aufr33: {
              male: 'u1/j1/gender/aufr33/male.mp3',
              female: 'u1/j1/gender/aufr33/female.mp3',
            },
          },
        },
      },
    };
    sqlResponses.push([job]);
    const res = makeRes();
    await handler(authedReq(), res);

    expect(res.statusCode).toBe(200);
    const { job: result } = res.body;

    // genderVoices debe existir con la estructura anidada firmada
    expect(result.genderVoices).toBeDefined();
    expect(result.genderVoices.chorus.male).toBe('signed://u1/j1/gender/chorus/male.mp3');
    expect(result.genderVoices.chorus.female).toBe('signed://u1/j1/gender/chorus/female.mp3');
    expect(result.genderVoices.aufr33.male).toBe('signed://u1/j1/gender/aufr33/male.mp3');
    expect(result.genderVoices.aufr33.female).toBe('signed://u1/j1/gender/aufr33/female.mp3');

    // 4 llamadas para los 4 stems de gender
    expect(signStemsDownload).toHaveBeenCalledTimes(4);
  });

  it('SEC-07: key con prefijo ajeno NO se firma; key legítima sí se firma', async () => {
    const job = {
      id: 'job1',
      user_id: 'victima_legit',
      status: 'done',
      sections: {
        voiceInstrumental: {
          outputs: {
            vocals: 'victima_legit/job1/stems/vocals.mp3', // legítima
            evil: 'atacante/otrojob/stems/x.mp3', // inyectada
          },
        },
        leadBacking: { outputs: {} },
      },
    };
    sqlResponses.push([job]);
    const res = makeRes();
    await handler(authedReq({ query: { id: 'job1' } }), res);

    expect(res.statusCode).toBe(200);
    const { job: result } = res.body;

    // La key legítima debe estar firmada
    expect(result.stems.vocals).toBe('signed://victima_legit/job1/stems/vocals.mp3');
    // La key inyectada NO debe generar signed URL
    expect(result.stems.evil).toBeUndefined();
    // signStemsDownload nunca se llama para la key ajena
    expect(signStemsDownload).toHaveBeenCalledTimes(1);
    expect(signStemsDownload).toHaveBeenCalledWith('victima_legit/job1/stems/vocals.mp3');
    expect(signStemsDownload).not.toHaveBeenCalledWith('atacante/otrojob/stems/x.mp3');
  });

  it('processing reciente: devuelve job crudo sin aplanar (signStemsDownload no se llama)', async () => {
    const job = {
      id: 'j1',
      user_id: 'u1',
      status: 'processing',
      updated_at: new Date(Date.now() - 60_000).toISOString(), // 1 min atrás, no expirado
      sections: {
        voiceInstrumental: {
          outputs: {
            vocals: 'u1/j1/voiceInstrumental/vocals.mp3',
          },
        },
        leadBacking: {
          outputs: {
            lead: 'u1/j1/leadBacking/lead.mp3',
          },
        },
      },
    };
    sqlResponses.push([job]);
    const res = makeRes();
    await handler(authedReq(), res);

    expect(res.statusCode).toBe(200);
    const { job: result } = res.body;

    // No se aplanó: stems no existe como propiedad propia del job crudo
    expect(result.stems).toBeUndefined();
    expect(signStemsDownload).not.toHaveBeenCalled();
  });
});

describe('SEC-15: DTO omite columnas internas del payload al cliente', () => {
  it('done: input_path y predictions NO se exponen al cliente', async () => {
    const job = {
      id: 'j1',
      user_id: 'u1',
      status: 'done',
      input_path: 'u1/j1/input.mp3', // columna interna — no debe salir
      predictions: { someKey: 'internal' }, // columna interna — no debe salir
      input_meta: { filename: 'cancion.mp3' }, // sí la usa el front
      sections: {
        voiceInstrumental: { outputs: { vocals: 'u1/j1/voiceInstrumental/vocals.mp3' } },
        leadBacking: { outputs: {} },
      },
    };
    sqlResponses.push([job]);
    const res = makeRes();
    await handler(authedReq(), res);

    expect(res.statusCode).toBe(200);
    const { job: result } = res.body;

    expect(result.input_path).toBeUndefined();
    expect(result.predictions).toBeUndefined();
    // input_meta sí debe estar (el front la usa para el nombre de archivo)
    expect(result.input_meta).toEqual({ filename: 'cancion.mp3' });
    // status e id deben seguir presentes
    expect(result.status).toBe('done');
    expect(result.id).toBe('j1');
  });

  it('processing: input_path y predictions NO se exponen al cliente', async () => {
    const job = {
      id: 'j1',
      user_id: 'u1',
      status: 'processing',
      updated_at: new Date(Date.now() - 60_000).toISOString(),
      input_path: 'u1/j1/input.mp3',
      predictions: { step: 1 },
      input_meta: { filename: 'tema.mp3' },
      sections: { voiceInstrumental: { outputs: {} }, leadBacking: { outputs: {} } },
    };
    sqlResponses.push([job]);
    const res = makeRes();
    await handler(authedReq(), res);

    expect(res.statusCode).toBe(200);
    const { job: result } = res.body;

    expect(result.input_path).toBeUndefined();
    expect(result.predictions).toBeUndefined();
    expect(result.input_meta).toEqual({ filename: 'tema.mp3' });
    expect(result.status).toBe('processing');
  });
});
