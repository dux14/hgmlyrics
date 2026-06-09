# Estudio de pistas (separación de stems y voces) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **GUARD DE RAMA (obligatorio para subagentes):** todo el trabajo va en la rama `feat/estudio-stems`. Antes de CUALQUIER edición ejecuta `git branch --show-current`; si no estás en `feat/estudio-stems`, créala desde master (`git checkout -b feat/estudio-stems`) o haz checkout. NUNCA commitees a master.

**Goal:** Nueva página `#/estudio` donde un usuario logueado sube un audio (≤25 MB) y recibe 6 stems + separación de voces (líder/coros + segmentos por cantante), procesado en Replicate, con resultados efímeros (48 h).

**Architecture:** Vercel functions orquestan; el audio sube directo del browser a Supabase Storage (signed upload URL); Replicate procesa en 2 etapas (6-stem → karaoke + diarización sobre el stem vocal) y avisa por webhooks firmados; un cron horario limpia lo expirado. Frontend vanilla JS con polling cada 5 s.

**Tech Stack:** Vanilla JS + Vite (frontend), Vercel serverless (`api/`), Supabase (Postgres vía `postgres`, Storage, Auth JWT), Replicate REST API (sin SDK, `fetch` nativo), Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-06-03-separacion-stems-voces-design.md`

**Convenciones del repo que DEBES seguir:**
- `pnpm` siempre, nunca `npm`/`yarn`.
- Endpoints: `withErrors(async (req,res) => ...)` + `allowMethods(req,res,[...])` (ver `api/_lib/http.js`), `sql` singleton de `api/_lib/db.js`, auth con `requireUser(req)` de `api/_lib/auth.js`.
- Tests en `tests/*.test.js`, mockeando `@supabase/supabase-js` y `postgres` ANTES del import dinámico (patrón de `tests/apiAuth.test.js`).
- Comentarios y copy de UI en español; código (nombres) en inglés.
- Prettier: singleQuote, printWidth 100. Corre `pnpm lint` antes de cada commit.

---

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `supabase/migrations/<ts>_stem_jobs.sql` | Create | Tabla `stem_jobs` + bucket privado `stems-jobs` |
| `api/_lib/replicate.js` | Create | Cliente REST Replicate + verificación de firma de webhook |
| `api/_lib/stems.js` | Create | Dominio: máquina de estados, cuota, expiración, validación de archivo |
| `api/_lib/storage.js` | Modify | + helpers del bucket `stems-jobs` (signed upload/download, copia desde URL, borrado por prefijo) |
| `api/stems/_models.js` | Create | Model registry: etapa → slug Replicate + builder de input |
| `api/stems/_process.js` | Create | Procesa el resultado de una predicción (compartido por webhook y reconciliación) |
| `api/stems/jobs.js` | Create | POST crear job + signed upload; GET listar jobs del usuario + cuota |
| `api/stems/jobs/[id].js` | Create | GET estado + signed URLs si done + reconciliación si está estancado |
| `api/stems/jobs/[id]/start.js` | Create | POST confirmar upload y disparar etapa 1 |
| `api/stems/webhook.js` | Create | POST webhook Replicate (firma, raw body, maxDuration 300) |
| `api/stems/cleanup.js` | Create | Cron: expira >48 h, mata zombis >30 min, borra Storage |
| `vercel.json` | Modify | crons + maxDuration 300 para webhook |
| `src/lib/stemsApi.js` | Create | Cliente API del frontend (crear, subir, iniciar, poll, listar) |
| `src/components/StudioPage.js` | Create | Página `#/estudio` con los 5 estados de UI |
| `src/main.js` | Modify | `guardedRoute('/estudio', ...)` |
| `src/components/AuthButton.js` | Modify | Item de menú "Estudio BETA" |
| `tests/stemsDomain.test.js` | Create | Máquina de estados, cuota, validación |
| `tests/replicateClient.test.js` | Create | Firma de webhook + createPrediction |
| `tests/apiStemsJobs.test.js` | Create | POST/GET jobs (cuota, job activo, validación) |
| `tests/apiStemsWebhook.test.js` | Create | Firma inválida 401, transiciones de etapas |
| `tests/studioPage.test.js` | Create | Render de los 5 estados |

**Env vars nuevas (agregar en Vercel y `.env` local):** `REPLICATE_API_TOKEN`, `REPLICATE_WEBHOOK_SECRET`, `CRON_SECRET`, `PUBLIC_BASE_URL` (ej. `https://hgmlyrics.vercel.app`).

---

### Task 0: Rama de trabajo

- [ ] **Step 1: Crear la rama**

```bash
cd /home/samu/code/personal/Mark-N-Hkl/hgmlyrics
git checkout master && git pull && git checkout -b feat/estudio-stems
git branch --show-current   # Expected: feat/estudio-stems
```

---

### Task 1: Migración — tabla `stem_jobs` + bucket `stems-jobs`

**Files:**
- Create: `supabase/migrations/20260603120000_stem_jobs.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- Estudio de pistas: jobs de separación de stems/voces (efímeros, 48h)
CREATE TABLE stem_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'created'
              CHECK (status IN ('created','uploaded','separating_stems','separating_voices','done','failed','expired')),
  input_path  text,
  input_meta  jsonb,
  stems       jsonb,
  voices      jsonb,
  predictions jsonb NOT NULL DEFAULT '{}'::jsonb,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz
);

CREATE INDEX stem_jobs_user_created_idx ON stem_jobs (user_id, created_at DESC);
CREATE INDEX stem_jobs_status_idx ON stem_jobs (status);

-- Solo el service role toca esta tabla (los endpoints usan el pooler con service key).
ALTER TABLE stem_jobs ENABLE ROW LEVEL SECURITY;

-- Bucket privado para inputs y resultados
INSERT INTO storage.buckets (id, name, public)
VALUES ('stems-jobs', 'stems-jobs', false)
ON CONFLICT (id) DO NOTHING;

-- Subida directa desde el browser SOLO vía signed upload URL (no se necesita policy de INSERT
-- para authenticated: uploadToSignedUrl usa el token firmado emitido por el service role).
```

- [ ] **Step 2: Aplicar y verificar**

```bash
supabase db push
supabase db shell? # si no hay shell local: verificar via:
echo "SELECT to_regclass('public.stem_jobs'); SELECT id FROM storage.buckets WHERE id='stems-jobs';" | supabase db query -
```
Expected: `stem_jobs` existe y el bucket `stems-jobs` aparece.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260603120000_stem_jobs.sql
git commit -m "feat(estudio): migración stem_jobs + bucket stems-jobs"
```

---

### Task 2: Dominio — `api/_lib/stems.js` (máquina de estados, cuota, validación)

**Files:**
- Create: `api/_lib/stems.js`
- Test: `tests/stemsDomain.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

```js
import { describe, it, expect } from 'vitest';
import {
  canTransition,
  DAILY_QUOTA,
  ACTIVE_STATUSES,
  expiresAt,
  validateUploadMeta,
} from '../api/_lib/stems.js';

describe('canTransition', () => {
  it('permite el camino feliz completo', () => {
    expect(canTransition('created', 'uploaded')).toBe(true);
    expect(canTransition('uploaded', 'separating_stems')).toBe(true);
    expect(canTransition('separating_stems', 'separating_voices')).toBe(true);
    expect(canTransition('separating_voices', 'done')).toBe(true);
    expect(canTransition('done', 'expired')).toBe(true);
  });

  it('permite failed desde estados en proceso, no desde done', () => {
    expect(canTransition('separating_stems', 'failed')).toBe(true);
    expect(canTransition('separating_voices', 'failed')).toBe(true);
    expect(canTransition('done', 'failed')).toBe(false);
  });

  it('rechaza retrocesos y estados desconocidos', () => {
    expect(canTransition('done', 'separating_stems')).toBe(false);
    expect(canTransition('expired', 'done')).toBe(false);
    expect(canTransition('nope', 'done')).toBe(false);
  });
});

describe('expiresAt', () => {
  it('devuelve created + 48h', () => {
    const base = new Date('2026-06-03T10:00:00Z');
    expect(expiresAt(base).toISOString()).toBe('2026-06-05T10:00:00.000Z');
  });
});

describe('validateUploadMeta', () => {
  const ok = { filename: 'cancion.mp3', size: 10 * 1024 * 1024, mime: 'audio/mpeg' };

  it('acepta un mp3 de 10MB', () => {
    expect(() => validateUploadMeta(ok)).not.toThrow();
  });

  it('rechaza > 25MB con status 400', () => {
    expect(() => validateUploadMeta({ ...ok, size: 26 * 1024 * 1024 })).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('rechaza mime no-audio', () => {
    expect(() => validateUploadMeta({ ...ok, mime: 'application/pdf' })).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('rechaza filename vacío', () => {
    expect(() => validateUploadMeta({ ...ok, filename: '' })).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });
});

describe('constantes', () => {
  it('cuota diaria es 3 y los estados activos son los de proceso', () => {
    expect(DAILY_QUOTA).toBe(3);
    expect(ACTIVE_STATUSES).toEqual(['created', 'uploaded', 'separating_stems', 'separating_voices']);
  });
});
```

- [ ] **Step 2: Verificar que fallan**

```bash
pnpm vitest run tests/stemsDomain.test.js
```
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `api/_lib/stems.js`**

```js
/**
 * stems.js — Dominio del Estudio de pistas: máquina de estados, cuota, validación.
 * Sin I/O: todo puro para poder testearlo sin mocks.
 */

export const DAILY_QUOTA = 3;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const RESULT_TTL_MS = 48 * 60 * 60 * 1000;
export const ACTIVE_STATUSES = ['created', 'uploaded', 'separating_stems', 'separating_voices'];

const AUDIO_MIMES = new Set([
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/flac',
  'audio/ogg',
]);

/** Transiciones válidas (solo hacia adelante). */
const NEXT = {
  created: ['uploaded', 'failed'],
  uploaded: ['separating_stems', 'failed'],
  separating_stems: ['separating_voices', 'failed'],
  separating_voices: ['done', 'failed'],
  done: ['expired'],
  failed: [],
  expired: [],
};

/**
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export function canTransition(from, to) {
  return NEXT[from]?.includes(to) ?? false;
}

/**
 * Fecha de expiración del resultado.
 * @param {Date} [from]
 * @returns {Date}
 */
export function expiresAt(from = new Date()) {
  return new Date(from.getTime() + RESULT_TTL_MS);
}

/**
 * Valida los metadatos del archivo a subir. Lanza { status: 400 } si no pasa.
 * @param {{ filename?: string, size?: number, mime?: string }} meta
 */
export function validateUploadMeta({ filename, size, mime } = {}) {
  const fail = (msg) => {
    const e = new Error(msg);
    e.status = 400;
    throw e;
  };
  if (!filename || typeof filename !== 'string') fail('Falta el nombre del archivo');
  if (!Number.isFinite(size) || size <= 0) fail('Tamaño de archivo inválido');
  if (size > MAX_FILE_BYTES) fail('El archivo supera el máximo de 25 MB');
  if (!mime || !AUDIO_MIMES.has(mime)) fail('Formato no soportado: sube MP3, WAV, M4A, FLAC u OGG');
}
```

- [ ] **Step 4: Verificar que pasan**

```bash
pnpm vitest run tests/stemsDomain.test.js
```
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add api/_lib/stems.js tests/stemsDomain.test.js
git commit -m "feat(estudio): dominio stems (máquina de estados, cuota, validación)"
```

---

### Task 3: Cliente Replicate — `api/_lib/replicate.js`

**Files:**
- Create: `api/_lib/replicate.js`
- Test: `tests/replicateClient.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

process.env.REPLICATE_API_TOKEN = 'r8_test_token';

const { createPrediction, getPrediction, verifyWebhookSignature } = await import(
  '../api/_lib/replicate.js'
);

describe('verifyWebhookSignature', () => {
  const secret = 'whsec_' + Buffer.from('super-secret-key').toString('base64');
  const id = 'msg_123';
  const timestamp = '1718000000';
  const body = '{"status":"succeeded"}';

  function sign(key, content) {
    return createHmac('sha256', key).update(content).digest('base64');
  }

  it('acepta una firma válida', () => {
    const key = Buffer.from(secret.split('_')[1], 'base64');
    const sig = sign(key, `${id}.${timestamp}.${body}`);
    expect(
      verifyWebhookSignature({ id, timestamp, signatures: `v1,${sig}`, body, secret }),
    ).toBe(true);
  });

  it('rechaza una firma inválida', () => {
    expect(
      verifyWebhookSignature({ id, timestamp, signatures: 'v1,AAAA', body, secret }),
    ).toBe(false);
  });

  it('rechaza si falta algún header', () => {
    expect(verifyWebhookSignature({ id: '', timestamp, signatures: 'v1,x', body, secret })).toBe(
      false,
    );
  });
});

describe('createPrediction / getPrediction', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hace POST al endpoint del modelo con webhook y token', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'pred_1' }) });
    const out = await createPrediction({
      model: 'owner/model',
      input: { audio: 'https://x/audio.mp3' },
      webhook: 'https://app/api/stems/webhook?job=j1&kind=stems',
    });
    expect(out.id).toBe('pred_1');
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://api.replicate.com/v1/models/owner/model/predictions');
    expect(opts.headers.Authorization).toBe('Bearer r8_test_token');
    const body = JSON.parse(opts.body);
    expect(body.webhook).toContain('/api/stems/webhook');
    expect(body.webhook_events_filter).toEqual(['completed']);
  });

  it('lanza 502 si Replicate responde error', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 422, text: async () => 'bad input' });
    await expect(
      createPrediction({ model: 'o/m', input: {}, webhook: 'https://x' }),
    ).rejects.toMatchObject({ status: 502 });
  });

  it('getPrediction consulta por id', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'p9', status: 'succeeded' }) });
    const out = await getPrediction('p9');
    expect(fetch.mock.calls[0][0]).toBe('https://api.replicate.com/v1/predictions/p9');
    expect(out.status).toBe('succeeded');
  });
});
```

- [ ] **Step 2: Verificar que fallan**

```bash
pnpm vitest run tests/replicateClient.test.js
```
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `api/_lib/replicate.js`**

```js
/**
 * replicate.js — Cliente mínimo de la REST API de Replicate (sin SDK).
 * Docs: https://replicate.com/docs/topics/webhooks/verify-webhook
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const API = 'https://api.replicate.com/v1';

function authHeaders() {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    const e = new Error('REPLICATE_API_TOKEN no configurado');
    e.status = 500;
    throw e;
  }
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function replicateFetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...authHeaders(), ...opts.headers } });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const e = new Error(`Replicate ${res.status}: ${detail.slice(0, 200)}`);
    e.status = 502;
    throw e;
  }
  return res.json();
}

/**
 * Crea una predicción contra la última versión del modelo.
 * @param {{ model: string, input: object, webhook: string }} args
 */
export async function createPrediction({ model, input, webhook }) {
  return replicateFetch(`${API}/models/${model}/predictions`, {
    method: 'POST',
    body: JSON.stringify({ input, webhook, webhook_events_filter: ['completed'] }),
  });
}

/** @param {string} id */
export async function getPrediction(id) {
  return replicateFetch(`${API}/predictions/${id}`);
}

/**
 * Verifica la firma svix-style de un webhook de Replicate.
 * signatures: "v1,<base64> v1,<base64>..." — válida si ALGUNA coincide.
 * @returns {boolean}
 */
export function verifyWebhookSignature({ id, timestamp, signatures, body, secret }) {
  if (!id || !timestamp || !signatures || !secret) return false;
  const key = Buffer.from(secret.split('_')[1] ?? '', 'base64');
  if (key.length === 0) return false;
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  return signatures.split(' ').some((entry) => {
    const sig = entry.split(',')[1];
    if (!sig) return false;
    const candidate = Buffer.from(sig, 'base64');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}
```

- [ ] **Step 4: Verificar que pasan**

```bash
pnpm vitest run tests/replicateClient.test.js
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/replicate.js tests/replicateClient.test.js
git commit -m "feat(estudio): cliente Replicate + verificación de firma de webhook"
```

---

### Task 4: Model registry — `api/stems/_models.js` (con verificación de slugs REAL)

**Files:**
- Create: `api/stems/_models.js`

Los slugs de Replicate cambian; este task los VERIFICA contra la API antes de fijarlos. El registry es el ÚNICO lugar donde viven.

- [ ] **Step 1: Buscar y verificar modelos disponibles (manual, documentar resultado)**

```bash
# 6-stem (candidato principal: ryan5453/demucs con htdemucs_6s)
curl -s -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  "https://api.replicate.com/v1/models/ryan5453/demucs" | head -c 400
# Karaoke (lead/backing) y diarización: buscar y elegir el mejor disponible
curl -s -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  "https://api.replicate.com/v1/search?query=vocal+separation+roformer" | python3 -m json.tool | head -50
curl -s -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  "https://api.replicate.com/v1/search?query=speaker+diarization" | python3 -m json.tool | head -50
```
Expected: respuestas 200 con metadata de modelos. **Anota los slugs elegidos y el shape EXACTO del output de cada uno** (campo de ejemplo en `latest_version.openapi_schema`). Si no existe modelo karaoke utilizable, usa el mismo modelo de stems en modo 2-stem sobre el stem vocal como aproximación líder/coros y documenta la limitación en el registry.

- [ ] **Step 2: Implementar el registry con los slugs verificados**

```js
/**
 * _models.js — Registry de modelos Replicate del Estudio de pistas.
 * ÚNICO lugar donde viven slugs e inputs. Si un modelo cambia, se toca SOLO este archivo.
 * Slugs verificados el 2026-06-XX contra la API (ver plan Task 4 Step 1).
 */

export const MODELS = {
  // Etapa 1: separación 6-stem. ryan5453/demucs corre htdemucs_6s.
  stems: {
    slug: 'ryan5453/demucs', // VERIFICADO Task 4 Step 1 — actualizar si cambió
    buildInput: (audioUrl) => ({
      audio: audioUrl,
      model: 'htdemucs_6s',
      output_format: 'wav',
    }),
    /**
     * Normaliza el output del modelo a { vocals, drums, bass, guitar, piano, other } → URL.
     * @param {object} output - output crudo de la predicción
     */
    parseOutput: (output) => ({
      vocals: output.vocals,
      drums: output.drums,
      bass: output.bass,
      guitar: output.guitar,
      piano: output.piano,
      other: output.other,
    }),
  },

  // Etapa 2a: líder vs coros sobre el stem vocal.
  karaoke: {
    slug: 'REEMPLAZAR/CON-SLUG-VERIFICADO', // del Step 1; ver nota de fallback
    buildInput: (vocalUrl) => ({ audio: vocalUrl }),
    parseOutput: (output) => ({ lead: output.lead ?? output.vocals, backing: output.backing ?? output.other }),
  },

  // Etapa 2b: diarización (segmentos por cantante) sobre el stem vocal.
  diarization: {
    slug: 'REEMPLAZAR/CON-SLUG-VERIFICADO', // del Step 1 (candidato: pyannote 3.x)
    buildInput: (vocalUrl) => ({ audio: vocalUrl }),
    /** Normaliza a [{ voice: 'Voz 1', start: seg, end: seg }] */
    parseOutput: (output) => {
      const segments = output.segments ?? output;
      const speakerNames = new Map();
      return (Array.isArray(segments) ? segments : []).map((s) => {
        const raw = s.speaker ?? s.label ?? 'S0';
        if (!speakerNames.has(raw)) speakerNames.set(raw, `Voz ${speakerNames.size + 1}`);
        return { voice: speakerNames.get(raw), start: Number(s.start), end: Number(s.end) };
      });
    },
  },
};
```

**IMPORTANTE:** los dos `REEMPLAZAR/CON-SLUG-VERIFICADO` DEBEN quedar resueltos en este task con los slugs reales del Step 1 (y `buildInput`/`parseOutput` ajustados al schema real de cada modelo). No avances a Task 5 con placeholders — este es el único punto del plan donde un valor depende de un servicio externo y se resuelve aquí, no después.

- [ ] **Step 3: Lint + commit**

```bash
pnpm lint
git add api/stems/_models.js
git commit -m "feat(estudio): model registry Replicate con slugs verificados"
```

---

### Task 5: Storage helpers — extender `api/_lib/storage.js`

**Files:**
- Modify: `api/_lib/storage.js` (agregar al final; NO tocar lo existente)

- [ ] **Step 1: Agregar helpers del bucket stems**

```js
// ──────────────────────────────────────────────
// Estudio de pistas — bucket privado 'stems-jobs'
// ──────────────────────────────────────────────
const STEMS_BUCKET = 'stems-jobs';

/**
 * Signed upload URL para que el browser suba el input directo a Storage.
 * @param {string} key - p.ej. `${userId}/${jobId}/input/cancion.mp3`
 * @returns {Promise<{ path: string, token: string }>}
 */
export async function createStemsUploadUrl(key) {
  const { data, error } = await supabase.storage.from(STEMS_BUCKET).createSignedUploadUrl(key);
  if (error) throw error;
  return { path: data.path, token: data.token };
}

/**
 * Copia un archivo remoto (output de Replicate) al bucket de stems.
 * @param {string} url - URL temporal de replicate.delivery
 * @param {string} key - destino en el bucket
 */
export async function copyUrlToStems(url, key) {
  const res = await fetch(url);
  if (!res.ok) {
    const e = new Error(`No se pudo descargar el resultado (${res.status})`);
    e.status = 502;
    throw e;
  }
  const body = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') ?? 'audio/wav';
  const { error } = await supabase.storage
    .from(STEMS_BUCKET)
    .upload(key, body, { contentType, upsert: true });
  if (error) throw error;
  return key;
}

/**
 * Signed URL de descarga (1h por defecto).
 * @param {string} key
 * @param {number} [expiresIn]
 */
export async function signStemsDownload(key, expiresIn = 3600) {
  const { data, error } = await supabase.storage
    .from(STEMS_BUCKET)
    .createSignedUrl(key, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

/**
 * Borra TODOS los archivos bajo un prefijo (input + resultados de un job).
 * @param {string} prefix - p.ej. `${userId}/${jobId}`
 */
export async function deleteStemsPrefix(prefix) {
  const toDelete = [];
  // El bucket anida input/ stems/ voices/: listar cada nivel conocido.
  for (const sub of ['input', 'stems', 'voices']) {
    const { data, error } = await supabase.storage.from(STEMS_BUCKET).list(`${prefix}/${sub}`);
    if (error || !data) continue;
    for (const f of data) toDelete.push(`${prefix}/${sub}/${f.name}`);
  }
  if (toDelete.length > 0) {
    await supabase.storage.from(STEMS_BUCKET).remove(toDelete);
  }
}
```

- [ ] **Step 2: Lint + suite completa (no debe romper nada existente)**

```bash
pnpm lint && pnpm vitest run
```
Expected: PASS (los tests existentes de `supabase-storage.test.js` siguen verdes).

- [ ] **Step 3: Commit**

```bash
git add api/_lib/storage.js
git commit -m "feat(estudio): helpers de Storage para bucket stems-jobs"
```

---

### Task 6: Endpoints crear/listar — `api/stems/jobs.js`

**Files:**
- Create: `api/stems/jobs.js`
- Test: `tests/apiStemsJobs.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
const mockCreateSignedUploadUrl = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    storage: {
      from: () => ({ createSignedUploadUrl: mockCreateSignedUploadUrl }),
    },
  }),
}));

// sql mock: función template-tag que devuelve respuestas encoladas
const sqlResponses = [];
const sqlCalls = [];
function sqlMock(strings, ...values) {
  sqlCalls.push({ text: strings.join('?'), values });
  return Promise.resolve(sqlResponses.shift() ?? []);
}
sqlMock.json = (v) => v;
vi.mock('postgres', () => ({ default: () => sqlMock }));

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
process.env.DATABASE_URL = 'postgresql://test';

const handler = (await import('../api/stems/jobs.js')).default;

function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return res;
}

const authedReq = (over = {}) => ({
  method: 'POST',
  headers: { authorization: 'Bearer tok' },
  body: { filename: 'a.mp3', size: 1024, mime: 'audio/mpeg' },
  ...over,
});

beforeEach(() => {
  mockGetUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.c' } }, error: null });
  mockCreateSignedUploadUrl.mockReset().mockResolvedValue({ data: { path: 'p', token: 't' }, error: null });
  sqlResponses.length = 0;
  sqlCalls.length = 0;
});

describe('POST /api/stems/jobs', () => {
  it('409 si hay un job activo', async () => {
    sqlResponses.push([{ id: 'job-activo' }]); // query de job activo
    const res = makeRes();
    await handler(authedReq(), res);
    expect(res.statusCode).toBe(409);
  });

  it('429 si la cuota diaria está agotada', async () => {
    sqlResponses.push([]); // sin job activo
    sqlResponses.push([{ n: 3 }]); // cuota usada
    const res = makeRes();
    await handler(authedReq(), res);
    expect(res.statusCode).toBe(429);
  });

  it('400 si el archivo no es audio', async () => {
    sqlResponses.push([]); // sin job activo
    sqlResponses.push([{ n: 0 }]);
    const res = makeRes();
    await handler(authedReq({ body: { filename: 'x.pdf', size: 99, mime: 'application/pdf' } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('crea el job y devuelve upload firmado', async () => {
    sqlResponses.push([]); // sin job activo
    sqlResponses.push([{ n: 1 }]); // cuota 1/3
    sqlResponses.push([{ id: 'j1', status: 'created' }]); // INSERT ... RETURNING
    const res = makeRes();
    await handler(authedReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.job.id).toBe('j1');
    expect(res.body.upload).toEqual({ path: 'p', token: 't' });
  });
});

describe('GET /api/stems/jobs', () => {
  it('lista jobs vigentes + cuota', async () => {
    sqlResponses.push([{ id: 'j1', status: 'done' }]); // jobs
    sqlResponses.push([{ n: 2 }]); // cuota usada
    const res = makeRes();
    await handler(authedReq({ method: 'GET', body: undefined }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.quota).toEqual({ used: 2, limit: 3 });
  });
});
```

- [ ] **Step 2: Verificar que fallan**

```bash
pnpm vitest run tests/apiStemsJobs.test.js
```
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `api/stems/jobs.js`**

```js
import sql from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { createStemsUploadUrl } from '../_lib/storage.js';
import { ACTIVE_STATUSES, DAILY_QUOTA, validateUploadMeta } from '../_lib/stems.js';

async function quotaUsedToday(userId) {
  const rows = await sql`
    SELECT count(*)::int AS n FROM stem_jobs
    WHERE user_id = ${userId} AND status <> 'failed'
      AND created_at >= date_trunc('day', now())
  `;
  return rows[0]?.n ?? 0;
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST', 'GET'])) return;
  const user = await requireUser(req);

  if (req.method === 'GET') {
    const jobs = await sql`
      SELECT id, status, input_meta, stems, voices, error, created_at, expires_at
      FROM stem_jobs
      WHERE user_id = ${user.id} AND status <> 'expired'
        AND created_at > now() - interval '3 days'
      ORDER BY created_at DESC
    `;
    const used = await quotaUsedToday(user.id);
    res.status(200).json({ jobs, quota: { used, limit: DAILY_QUOTA } });
    return;
  }

  // POST: crear job
  const active = await sql`
    SELECT id FROM stem_jobs
    WHERE user_id = ${user.id} AND status IN ${sql(ACTIVE_STATUSES)}
    LIMIT 1
  `;
  if (active.length > 0) {
    const e = new Error('Ya tienes una canción en proceso. Espera a que termine.');
    e.status = 409;
    throw e;
  }

  const used = await quotaUsedToday(user.id);
  if (used >= DAILY_QUOTA) {
    const e = new Error(`Alcanzaste el límite de ${DAILY_QUOTA} canciones por día. Vuelve mañana.`);
    e.status = 429;
    throw e;
  }

  const { filename, size, mime } = req.body ?? {};
  validateUploadMeta({ filename, size, mime });

  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const rows = await sql`
    INSERT INTO stem_jobs (user_id, status, input_meta)
    VALUES (${user.id}, 'created', ${sql.json({ filename: safe, size, mime })})
    RETURNING id, status, created_at
  `;
  const job = rows[0];
  const inputPath = `${user.id}/${job.id}/input/${safe}`;
  await sql`UPDATE stem_jobs SET input_path = ${inputPath}, updated_at = now() WHERE id = ${job.id}`;

  const upload = await createStemsUploadUrl(inputPath);
  res.status(200).json({ job, upload });
});
```

Nota: si el mock de `sql` del test no soporta `sql(ACTIVE_STATUSES)` (lista) o `sql.json`, ajusta el MOCK (no la implementación) agregando esas funciones al objeto `sqlMock`.

- [ ] **Step 4: Verificar que pasan**

```bash
pnpm vitest run tests/apiStemsJobs.test.js
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/stems/jobs.js tests/apiStemsJobs.test.js
git commit -m "feat(estudio): endpoints crear/listar jobs con cuota y upload firmado"
```

---

### Task 7: Procesador compartido — `api/stems/_process.js`

**Files:**
- Create: `api/stems/_process.js`

Lógica de "llegó el resultado de una predicción" usada por el webhook (camino feliz) y por la reconciliación de `GET jobs/[id]` (red de seguridad). Se testea vía los tests del webhook (Task 8).

- [ ] **Step 1: Implementar**

```js
/**
 * _process.js — Avance del pipeline cuando una predicción de Replicate termina.
 * Compartido por webhook.js (camino feliz) y jobs/[id].js (reconciliación).
 */
import { MODELS } from './_models.js';
import { createPrediction } from '../_lib/replicate.js';
import { copyUrlToStems, signStemsDownload } from '../_lib/storage.js';
import { canTransition, expiresAt } from '../_lib/stems.js';

const FRIENDLY_FAIL = 'El procesamiento falló. Intenta de nuevo (no consumió tu cuota).';

function webhookUrl(jobId, kind) {
  const base = process.env.PUBLIC_BASE_URL ?? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return `${base}/api/stems/webhook?job=${jobId}&kind=${kind}`;
}

/**
 * Aplica el resultado de una predicción al job. Idempotente: si el job ya avanzó, no hace nada.
 * @param {import('postgres').Sql} sql
 * @param {object} job - fila actual de stem_jobs
 * @param {'stems'|'karaoke'|'diarization'} kind
 * @param {object} prediction - payload de Replicate { status, output, error }
 */
export async function processPredictionResult(sql, job, kind, prediction) {
  if (prediction.status !== 'succeeded') {
    if (['failed', 'canceled'].includes(prediction.status) && canTransition(job.status, 'failed')) {
      await sql`
        UPDATE stem_jobs SET status = 'failed', error = ${FRIENDLY_FAIL}, updated_at = now()
        WHERE id = ${job.id} AND status = ${job.status}
      `;
    }
    return;
  }

  if (kind === 'stems') {
    if (job.status !== 'separating_stems') return; // ya procesado (idempotencia)
    const urls = MODELS.stems.parseOutput(prediction.output);
    const stems = {};
    for (const [name, url] of Object.entries(urls)) {
      if (!url) continue;
      stems[name] = await copyUrlToStems(url, `${job.user_id}/${job.id}/stems/${name}.wav`);
    }
    if (!stems.vocals) {
      await sql`
        UPDATE stem_jobs SET status = 'failed',
          error = 'No detectamos voces claras en este audio.', updated_at = now()
        WHERE id = ${job.id} AND status = 'separating_stems'
      `;
      return;
    }
    // Etapa 2: karaoke + diarización en paralelo sobre el stem vocal
    const vocalUrl = await signStemsDownload(stems.vocals, 3600);
    const [karaoke, diarization] = await Promise.all([
      createPrediction({
        model: MODELS.karaoke.slug,
        input: MODELS.karaoke.buildInput(vocalUrl),
        webhook: webhookUrl(job.id, 'karaoke'),
      }),
      createPrediction({
        model: MODELS.diarization.slug,
        input: MODELS.diarization.buildInput(vocalUrl),
        webhook: webhookUrl(job.id, 'diarization'),
      }),
    ]);
    await sql`
      UPDATE stem_jobs SET status = 'separating_voices',
        stems = ${sql.json(stems)},
        predictions = predictions || ${sql.json({ karaoke: karaoke.id, diarization: diarization.id })},
        updated_at = now()
      WHERE id = ${job.id} AND status = 'separating_stems'
    `;
    return;
  }

  // kind === 'karaoke' | 'diarization' (etapa 2)
  if (job.status !== 'separating_voices') return;
  const voices = job.voices ?? {};

  if (kind === 'karaoke' && voices.lead === undefined) {
    const out = MODELS.karaoke.parseOutput(prediction.output);
    voices.lead = out.lead
      ? await copyUrlToStems(out.lead, `${job.user_id}/${job.id}/voices/lead.wav`)
      : null;
    voices.backing = out.backing
      ? await copyUrlToStems(out.backing, `${job.user_id}/${job.id}/voices/backing.wav`)
      : null;
  }
  if (kind === 'diarization' && voices.segments === undefined) {
    voices.segments = MODELS.diarization.parseOutput(prediction.output);
  }

  const complete = voices.lead !== undefined && voices.segments !== undefined;
  if (complete) {
    await sql`
      UPDATE stem_jobs SET status = 'done', voices = ${sql.json(voices)},
        expires_at = ${expiresAt()}, updated_at = now()
      WHERE id = ${job.id} AND status = 'separating_voices'
    `;
  } else {
    await sql`
      UPDATE stem_jobs SET voices = ${sql.json(voices)}, updated_at = now()
      WHERE id = ${job.id} AND status = 'separating_voices'
    `;
  }
}
```

- [ ] **Step 2: Lint + commit (los tests llegan con el webhook en Task 8)**

```bash
pnpm lint
git add api/stems/_process.js
git commit -m "feat(estudio): procesador compartido de resultados de predicción"
```

---

### Task 8: Webhook — `api/stems/webhook.js`

**Files:**
- Create: `api/stems/webhook.js`
- Test: `tests/apiStemsWebhook.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

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
  const { Readable } = require('node:stream');
  const req = Readable.from([Buffer.from(body)]);
  req.method = 'POST';
  req.headers = { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${sig}` };
  req.query = { job, kind };
  req.url = `/api/stems/webhook?job=${job}&kind=${kind}`;
  return req;
}

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

beforeEach(() => {
  sqlResponses.length = 0;
  sqlCalls.length = 0;
  mockUpload.mockReset().mockResolvedValue({ data: {}, error: null });
  mockCreateSignedUrl.mockReset().mockResolvedValue({ data: { signedUrl: 'https://signed/x' }, error: null });
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
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(4), headers: { get: () => 'audio/wav' } };
    });
    const output = {
      vocals: 'https://r/v.wav', drums: 'https://r/d.wav', bass: 'https://r/b.wav',
      guitar: 'https://r/g.wav', piano: 'https://r/p.wav', other: 'https://r/o.wav',
    };
    const res = makeRes();
    await handler(signedReq({ status: 'succeeded', output }), res);
    expect(res.statusCode).toBe(200);
    expect(mockUpload).toHaveBeenCalledTimes(6);
    const replicateCalls = fetch.mock.calls.filter((c) => String(c[0]).includes('api.replicate.com'));
    expect(replicateCalls).toHaveLength(2); // karaoke + diarization
    expect(sqlCalls.some((c) => c.text.includes("status = 'separating_voices'"))).toBe(true);
  });

  it('etapa 2 completa (karaoke y diarización) → done', async () => {
    // Llega diarización cuando karaoke ya está en voices
    sqlResponses.push([
      { id: 'j1', user_id: 'u1', status: 'separating_voices', voices: { lead: 'l.wav', backing: 'b.wav' } },
    ]);
    sqlResponses.push([]); // UPDATE done
    const output = { segments: [{ speaker: 'SPEAKER_00', start: 1.5, end: 4.2 }] };
    const res = makeRes();
    await handler(signedReq({ status: 'succeeded', output }, { kind: 'diarization' }), res);
    expect(res.statusCode).toBe(200);
    expect(sqlCalls.some((c) => c.text.includes("status = 'done'"))).toBe(true);
  });
});
```

- [ ] **Step 2: Verificar que fallan**

```bash
pnpm vitest run tests/apiStemsWebhook.test.js
```
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `api/stems/webhook.js`**

```js
import sql from '../_lib/db.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { verifyWebhookSignature } from '../_lib/replicate.js';
import { processPredictionResult } from './_process.js';

// Raw body necesario para verificar la firma; copia los WAV → puede tardar.
export const config = {
  api: { bodyParser: false },
  maxDuration: 300,
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST'])) return;

  const body = await readRawBody(req);
  const ok = verifyWebhookSignature({
    id: req.headers['webhook-id'],
    timestamp: req.headers['webhook-timestamp'],
    signatures: req.headers['webhook-signature'],
    body,
    secret: process.env.REPLICATE_WEBHOOK_SECRET,
  });
  if (!ok) {
    res.status(401).json({ error: 'Firma de webhook inválida' });
    return;
  }

  // job y kind viajan en la query del webhook URL
  const url = new URL(req.url, 'http://local');
  const jobId = req.query?.job ?? url.searchParams.get('job');
  const kind = req.query?.kind ?? url.searchParams.get('kind');
  if (!jobId || !['stems', 'karaoke', 'diarization'].includes(kind)) {
    res.status(400).json({ error: 'Parámetros job/kind inválidos' });
    return;
  }

  const rows = await sql`SELECT * FROM stem_jobs WHERE id = ${jobId}`;
  if (rows.length === 0) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }

  const prediction = JSON.parse(body);
  await processPredictionResult(sql, rows[0], kind, prediction);
  res.status(200).json({ ok: true });
});
```

- [ ] **Step 4: Verificar que pasan**

```bash
pnpm vitest run tests/apiStemsWebhook.test.js
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add api/stems/webhook.js tests/apiStemsWebhook.test.js
git commit -m "feat(estudio): webhook Replicate con firma y avance de pipeline"
```

---

### Task 9: Estado del job + reconciliación — `api/stems/jobs/[id].js` y start — `api/stems/jobs/[id]/start.js`

**Files:**
- Create: `api/stems/jobs/[id].js`
- Create: `api/stems/jobs/[id]/start.js`

(La lógica pesada ya está testeada en `_process` vía webhook y en dominio; estos endpoints son glue. Los cubre el smoke de Task 12.)

- [ ] **Step 1: Implementar `api/stems/jobs/[id].js`**

```js
import sql from '../../_lib/db.js';
import { requireUser } from '../../_lib/auth.js';
import { allowMethods, withErrors } from '../../_lib/http.js';
import { signStemsDownload } from '../../_lib/storage.js';
import { getPrediction } from '../../_lib/replicate.js';
import { processPredictionResult } from '../_process.js';

const STALE_MS = 3 * 60 * 1000;

/** Convierte paths de storage a signed URLs de descarga para la respuesta. */
async function withSignedUrls(job) {
  const sign = async (obj) => {
    if (!obj) return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = typeof v === 'string' && v.includes('/') ? await signStemsDownload(v) : v;
    }
    return out;
  };
  return { ...job, stems: await sign(job.stems), voices: await sign(job.voices) };
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET'])) return;
  const user = await requireUser(req);
  const { id } = req.query;

  let rows = await sql`SELECT * FROM stem_jobs WHERE id = ${id} AND user_id = ${user.id}`;
  if (rows.length === 0) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }
  let job = rows[0];

  // Reconciliación: si está en proceso y sin avance > 3 min, consultar Replicate directo
  const inProgress = ['separating_stems', 'separating_voices'].includes(job.status);
  const stale = Date.now() - new Date(job.updated_at).getTime() > STALE_MS;
  if (inProgress && stale && job.predictions) {
    const kinds = job.status === 'separating_stems' ? ['stems'] : ['karaoke', 'diarization'];
    for (const kind of kinds) {
      const predId = job.predictions[kind];
      if (!predId) continue;
      const prediction = await getPrediction(predId);
      if (['succeeded', 'failed', 'canceled'].includes(prediction.status)) {
        await processPredictionResult(sql, job, kind, prediction);
        rows = await sql`SELECT * FROM stem_jobs WHERE id = ${id}`;
        job = rows[0];
      }
    }
  }

  res.status(200).json({ job: job.status === 'done' ? await withSignedUrls(job) : job });
});
```

- [ ] **Step 2: Implementar `api/stems/jobs/[id]/start.js`**

```js
import sql from '../../../_lib/db.js';
import { requireUser } from '../../../_lib/auth.js';
import { allowMethods, withErrors } from '../../../_lib/http.js';
import { signStemsDownload } from '../../../_lib/storage.js';
import { createPrediction } from '../../../_lib/replicate.js';
import { MODELS } from '../../_models.js';

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST'])) return;
  const user = await requireUser(req);
  const { id } = req.query;

  const rows = await sql`
    SELECT * FROM stem_jobs WHERE id = ${id} AND user_id = ${user.id}
  `;
  if (rows.length === 0) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }
  const job = rows[0];
  if (job.status !== 'created') {
    res.status(409).json({ error: `El job ya está en estado ${job.status}` });
    return;
  }

  // El archivo debe existir: si la signed URL no firma, no se subió.
  let audioUrl;
  try {
    audioUrl = await signStemsDownload(job.input_path, 3600);
  } catch {
    res.status(400).json({ error: 'El archivo no terminó de subirse. Intenta de nuevo.' });
    return;
  }

  const base = process.env.PUBLIC_BASE_URL ?? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  const prediction = await createPrediction({
    model: MODELS.stems.slug,
    input: MODELS.stems.buildInput(audioUrl),
    webhook: `${base}/api/stems/webhook?job=${job.id}&kind=stems`,
  });

  await sql`
    UPDATE stem_jobs SET status = 'separating_stems',
      predictions = predictions || ${sql.json({ stems: prediction.id })},
      updated_at = now()
    WHERE id = ${job.id} AND status = 'created'
  `;
  res.status(200).json({ ok: true });
});
```

- [ ] **Step 3: Lint + suite completa + commit**

```bash
pnpm lint && pnpm vitest run
git add api/stems/jobs/
git commit -m "feat(estudio): endpoints de estado (con reconciliación) y start"
```

---

### Task 10: Cleanup cron — `api/stems/cleanup.js` + `vercel.json`

**Files:**
- Create: `api/stems/cleanup.js`
- Modify: `vercel.json`

- [ ] **Step 1: Implementar `api/stems/cleanup.js`**

```js
import sql from '../_lib/db.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { deleteStemsPrefix } from '../_lib/storage.js';

// Vercel cron manda Authorization: Bearer ${CRON_SECRET}
export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET'])) return;
  const auth = req.headers?.authorization ?? '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }

  // 1) Expirar resultados > 48h: borrar archivos y limpiar paths
  const expired = await sql`
    SELECT id, user_id FROM stem_jobs
    WHERE status = 'done' AND expires_at < now()
  `;
  for (const job of expired) {
    await deleteStemsPrefix(`${job.user_id}/${job.id}`);
    await sql`
      UPDATE stem_jobs SET status = 'expired', stems = NULL, voices = NULL,
        input_path = NULL, updated_at = now()
      WHERE id = ${job.id}
    `;
  }

  // 2) Jobs zombi: en proceso > 30 min → failed (no consume cuota)
  const zombies = await sql`
    UPDATE stem_jobs SET status = 'failed',
      error = 'El procesamiento tardó demasiado y fue cancelado. Intenta de nuevo.',
      updated_at = now()
    WHERE status IN ('separating_stems', 'separating_voices')
      AND updated_at < now() - interval '30 minutes'
    RETURNING id, user_id
  `;
  for (const job of zombies) {
    await deleteStemsPrefix(`${job.user_id}/${job.id}`);
  }

  // 3) Uploads abandonados: created/uploaded > 24h → failed + limpiar
  const abandoned = await sql`
    UPDATE stem_jobs SET status = 'failed', error = 'Subida abandonada', updated_at = now()
    WHERE status IN ('created', 'uploaded') AND created_at < now() - interval '24 hours'
    RETURNING id, user_id
  `;
  for (const job of abandoned) {
    await deleteStemsPrefix(`${job.user_id}/${job.id}`);
  }

  res.status(200).json({ expired: expired.length, zombies: zombies.length, abandoned: abandoned.length });
});
```

- [ ] **Step 2: Actualizar `vercel.json`** (agregar crons y override de duración; conservar TODO lo existente)

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "pnpm build",
  "outputDirectory": "dist",
  "installCommand": "pnpm install --frozen-lockfile",
  "regions": ["pdx1"],
  "ignoreCommand": "git diff --quiet HEAD^ HEAD -- ':!docs' ':!*.md' ':!tests' ':!.lighthouserc.json' ':!.github' ':!CLAUDE.md' ':!MIGRATION_PLAN.md'",
  "functions": {
    "api/**/*.js": {
      "maxDuration": 10
    },
    "api/stems/webhook.js": {
      "maxDuration": 300
    },
    "api/stems/cleanup.js": {
      "maxDuration": 60
    }
  },
  "crons": [
    { "path": "/api/stems/cleanup", "schedule": "0 * * * *" }
  ]
}
```

- [ ] **Step 3: Lint + commit**

```bash
pnpm lint
git add api/stems/cleanup.js vercel.json
git commit -m "feat(estudio): cron de limpieza (expirados, zombis, abandonados)"
```

---

### Task 11: Cliente frontend — `src/lib/stemsApi.js`

**Files:**
- Create: `src/lib/stemsApi.js`

(Wrapper fino de fetch; lo cubren los tests de la página en Task 12.)

- [ ] **Step 1: Implementar**

```js
/**
 * stemsApi.js — Cliente del Estudio de pistas (api/stems/*).
 */
import { getSession } from './authStore.js';
import { supabase } from './supabase.js';

function authHeaders() {
  const s = getSession();
  return s ? { Authorization: `Bearer ${s.access_token}` } : {};
}

async function jsonOrThrow(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(body.error ?? `Error ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return body;
}

/** Crea el job y devuelve { job, upload } */
export async function createJob(file) {
  const res = await fetch('/api/stems/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ filename: file.name, size: file.size, mime: file.type }),
  });
  return jsonOrThrow(res);
}

/** Sube el archivo directo a Storage con el token firmado */
export async function uploadInput(upload, file) {
  const { error } = await supabase.storage
    .from('stems-jobs')
    .uploadToSignedUrl(upload.path, upload.token, file);
  if (error) throw new Error('La subida falló. Revisa tu conexión e intenta de nuevo.');
}

export async function startJob(id) {
  const res = await fetch(`/api/stems/jobs/${id}/start`, {
    method: 'POST',
    headers: authHeaders(),
  });
  return jsonOrThrow(res);
}

export async function getJob(id) {
  const res = await fetch(`/api/stems/jobs/${id}`, { headers: authHeaders() });
  return jsonOrThrow(res);
}

export async function listJobs() {
  const res = await fetch('/api/stems/jobs', { headers: authHeaders() });
  return jsonOrThrow(res);
}

/**
 * Lee la duración del audio en el browser (límite ~10 min).
 * @param {File} file
 * @returns {Promise<number>} segundos (0 si no se pudo leer; el server no la valida)
 */
export function readAudioDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    audio.src = url;
  });
}
```

- [ ] **Step 2: Lint + commit**

```bash
pnpm lint
git add src/lib/stemsApi.js
git commit -m "feat(estudio): cliente API frontend"
```

---

### Task 12: Página — `src/components/StudioPage.js` + ruta + menú

**Files:**
- Create: `src/components/StudioPage.js`
- Modify: `src/main.js` (junto a `guardedRoute('/recomendador', ...)`, ~línea 206)
- Modify: `src/components/AuthButton.js:35` (después del item Recomendador)
- Test: `tests/studioPage.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/lib/stemsApi.js', () => ({
  createJob: vi.fn(),
  uploadInput: vi.fn(),
  startJob: vi.fn(),
  getJob: vi.fn(),
  listJobs: vi.fn(),
  readAudioDuration: vi.fn().mockResolvedValue(180),
}));
vi.mock('../src/lib/authStore.js', () => ({
  getSession: () => ({ access_token: 'tok' }),
}));

const stemsApi = await import('../src/lib/stemsApi.js');
const { renderStudioPage } = await import('../src/components/StudioPage.js');

describe('renderStudioPage', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    container.remove();
    vi.clearAllMocks();
  });

  it('estado idle: dropzone + límites + cuota', async () => {
    stemsApi.listJobs.mockResolvedValueOnce({ jobs: [], quota: { used: 1, limit: 3 } });
    renderStudioPage(container);
    await vi.waitFor(() => expect(container.querySelector('.studio-dropzone')).not.toBeNull());
    expect(container.textContent).toContain('Estudio');
    expect(container.querySelector('.badge--beta')).not.toBeNull();
    expect(container.textContent).toContain('25 MB');
    expect(container.textContent).toContain('2 de 3'); // cuota restante hoy
  });

  it('retoma un job en proceso al entrar', async () => {
    stemsApi.listJobs.mockResolvedValueOnce({
      jobs: [{ id: 'j1', status: 'separating_stems' }],
      quota: { used: 1, limit: 3 },
    });
    stemsApi.getJob.mockResolvedValue({ job: { id: 'j1', status: 'separating_stems' } });
    renderStudioPage(container);
    await vi.waitFor(() => expect(container.textContent).toContain('Separando pistas'));
    expect(container.querySelector('[aria-live]')).not.toBeNull();
  });

  it('job done: muestra pistas, voces y expiración', async () => {
    stemsApi.listJobs.mockResolvedValueOnce({
      jobs: [{ id: 'j1', status: 'done' }],
      quota: { used: 1, limit: 3 },
    });
    stemsApi.getJob.mockResolvedValue({
      job: {
        id: 'j1',
        status: 'done',
        expires_at: new Date(Date.now() + 47 * 3600e3).toISOString(),
        stems: { vocals: 'https://s/v', drums: 'https://s/d' },
        voices: {
          lead: 'https://s/lead',
          backing: 'https://s/back',
          segments: [{ voice: 'Voz 1', start: 42, end: 70 }],
        },
      },
    });
    renderStudioPage(container);
    await vi.waitFor(() => expect(container.textContent).toContain('Pistas'));
    expect(container.querySelectorAll('audio').length).toBeGreaterThanOrEqual(4);
    expect(container.textContent).toContain('Voz 1');
    expect(container.textContent).toContain('0:42');
    expect(container.textContent.toLowerCase()).toContain('disponible por');
  });

  it('job failed: mensaje y reintentar', async () => {
    stemsApi.listJobs.mockResolvedValueOnce({
      jobs: [{ id: 'j1', status: 'failed', error: 'El procesamiento falló.' }],
      quota: { used: 0, limit: 3 },
    });
    stemsApi.getJob.mockResolvedValue({
      job: { id: 'j1', status: 'failed', error: 'El procesamiento falló.' },
    });
    renderStudioPage(container);
    await vi.waitFor(() => expect(container.textContent).toContain('falló'));
    expect(container.querySelector('#studio-retry')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Verificar que fallan**

```bash
pnpm vitest run tests/studioPage.test.js
```
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `src/components/StudioPage.js`**

```js
/**
 * StudioPage.js — Estudio de pistas (BETA): sube un audio, sepáralo en stems
 * y divide la pista vocal (líder/coros + segmentos por cantante).
 * Estados: idle → uploading → processing → done | failed.
 */
import { icon } from '../lib/icons.js';
import {
  createJob,
  uploadInput,
  startJob,
  getJob,
  listJobs,
  readAudioDuration,
} from '../lib/stemsApi.js';

const POLL_MS = 5000;
const MAX_DURATION_S = 10.5 * 60;
let pollTimer = null;

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function hoursLeft(expiresAt) {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 3600e3));
}

const STEM_LABELS = {
  vocals: 'Voz',
  drums: 'Batería',
  bass: 'Bajo',
  guitar: 'Guitarra',
  piano: 'Piano',
  other: 'Otros',
};

export function renderStudioPage(container) {
  stopPolling();
  window.addEventListener('hashchange', stopPolling, { once: true });
  container.innerHTML = `
    <div class="studio fade-in" style="max-width: 640px; margin: 0 auto; padding: 1rem;">
      <h1 style="display:flex; align-items:center; gap:.5rem;">
        ${icon('audio-lines', { size: 28 })} Estudio <span class="badge--beta">BETA</span>
      </h1>
      <div id="studio-body" aria-live="polite"></div>
    </div>
  `;
  const body = container.querySelector('#studio-body');
  void loadInitial(body);
}

async function loadInitial(body) {
  body.innerHTML = `<p class="empty-state__text">Cargando…</p>`;
  try {
    const { jobs, quota } = await listJobs();
    const active = jobs.find((j) =>
      ['created', 'uploaded', 'separating_stems', 'separating_voices'].includes(j.status),
    );
    const recent = jobs.find((j) => ['done', 'failed'].includes(j.status));
    if (active) return watchJob(body, active.id, quota);
    if (recent) return showJob(body, recent.id, quota);
    renderIdle(body, quota);
  } catch {
    body.innerHTML = `<p class="empty-state__text">No pudimos cargar el Estudio. Intenta de nuevo.</p>`;
  }
}

function renderIdle(body, quota) {
  const left = quota.limit - quota.used;
  body.innerHTML = `
    <p>Sube una canción y te la devolvemos separada en pistas (voz, batería, bajo, guitarra,
    piano y otros) más la voz dividida en <strong>líder/coros</strong> y segmentos por cantante.</p>
    <div class="studio-dropzone" role="button" tabindex="0" aria-label="Subir archivo de audio"
      style="border:2px dashed var(--border-color, #888); border-radius:12px; padding:2.5rem 1rem; text-align:center; cursor:pointer;">
      ${icon('upload', { size: 32 })}
      <p style="margin:.75rem 0 .25rem;"><strong>Arrastra tu audio aquí</strong> o toca para elegir</p>
      <p class="empty-state__text" style="margin:0;">MP3, WAV, M4A · máx 25 MB / 10 min</p>
    </div>
    <p class="empty-state__text" style="margin-top:.75rem;">
      Te quedan <strong>${left} de ${quota.limit}</strong> canciones hoy. Los resultados expiran a las 48 h.
    </p>
    <input type="file" id="studio-file" accept="audio/*" hidden />
  `;
  const drop = body.querySelector('.studio-dropzone');
  const input = body.querySelector('#studio-file');
  const pick = () => input.click();
  drop.addEventListener('click', pick);
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') pick();
  });
  drop.addEventListener('dragover', (e) => e.preventDefault());
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) void handleFile(body, file, quota);
  });
  input.addEventListener('change', () => {
    if (input.files?.[0]) void handleFile(body, input.files[0], quota);
  });
}

async function handleFile(body, file, quota) {
  const duration = await readAudioDuration(file);
  if (duration > MAX_DURATION_S) {
    renderIdle(body, quota);
    body.insertAdjacentHTML(
      'afterbegin',
      `<p class="empty-state__text" style="color:var(--danger,#c00);">El audio dura más de 10 minutos.</p>`,
    );
    return;
  }
  body.innerHTML = `<p aria-busy="true">Subiendo <strong>${file.name}</strong>…</p>`;
  try {
    const { job, upload } = await createJob(file);
    await uploadInput(upload, file);
    await startJob(job.id);
    watchJob(body, job.id, quota);
  } catch (e) {
    body.innerHTML = `
      <p class="empty-state__text" style="color:var(--danger,#c00);">${e.message}</p>
      <button class="btn btn--primary" id="studio-retry">Volver a intentar</button>
    `;
    body.querySelector('#studio-retry').addEventListener('click', () => renderIdle(body, quota));
  }
}

function watchJob(body, jobId, quota) {
  stopPolling();
  const tick = async () => {
    try {
      const { job } = await getJob(jobId);
      if (job.status === 'done' || job.status === 'failed') {
        stopPolling();
        renderJob(body, job, quota);
        return;
      }
      renderProcessing(body, job);
    } catch {
      /* siguiente tick reintenta */
    }
  };
  void tick();
  pollTimer = setInterval(tick, POLL_MS);
}

async function showJob(body, jobId, quota) {
  try {
    const { job } = await getJob(jobId);
    renderJob(body, job, quota);
  } catch {
    renderIdle(body, quota);
  }
}

function renderProcessing(body, job) {
  const step1Done = job.status === 'separating_voices';
  body.innerHTML = `
    <div class="studio-steps">
      <p>${step1Done ? '✅' : '⏳'} <strong>Separando pistas…</strong> ~2 min</p>
      <p>${step1Done ? '⏳' : '○'} <strong>Separando voces…</strong> ~2 min</p>
      <p class="empty-state__text">Puedes salir de esta página; el proceso sigue solo.</p>
    </div>
  `;
}

function renderJob(body, job, quota) {
  if (job.status === 'failed') {
    body.innerHTML = `
      <p class="empty-state__text" style="color:var(--danger,#c00);">${job.error ?? 'El procesamiento falló.'}</p>
      <button class="btn btn--primary" id="studio-retry">Procesar otra canción</button>
    `;
    body.querySelector('#studio-retry').addEventListener('click', () => renderIdle(body, quota));
    return;
  }

  const stems = job.stems ?? {};
  const voices = job.voices ?? {};
  const playerRow = (label, url) => `
    <div style="display:flex; align-items:center; gap:.5rem; margin:.5rem 0;">
      <span style="min-width:5.5rem;">${label}</span>
      <audio controls preload="none" src="${url}" style="flex:1; min-width:0;"></audio>
      <a class="btn" href="${url}" download aria-label="Descargar ${label}">${icon('download', { size: 16 })}</a>
    </div>
  `;

  const segments = Array.isArray(voices.segments) ? voices.segments : [];
  body.innerHTML = `
    <p class="empty-state__text">Disponible por <strong>${hoursLeft(job.expires_at)} h</strong> más.</p>
    <h2>Pistas</h2>
    ${Object.entries(STEM_LABELS)
      .filter(([k]) => stems[k])
      .map(([k, label]) => playerRow(label, stems[k]))
      .join('')}
    <h2>Voces</h2>
    <p class="empty-state__text">Las secciones en armonía simultánea se entregan como líder/coros;
    los segmentos alternados se reproducen sobre la pista de voz.</p>
    ${voices.lead ? playerRow('Voz líder', voices.lead) : ''}
    ${voices.backing ? playerRow('Coros', voices.backing) : ''}
    ${
      segments.length > 0
        ? `<h3>Segmentos por cantante</h3>
           <audio id="studio-vocal-seg" preload="none" src="${stems.vocals ?? voices.lead}"></audio>
           <ul style="list-style:none; padding:0;">
             ${segments
               .map(
                 (s, i) => `<li style="margin:.25rem 0;">
                   <button class="btn studio-seg" data-i="${i}" data-start="${s.start}" data-end="${s.end}">
                     ▶ ${s.voice}: ${fmtTime(s.start)}–${fmtTime(s.end)}
                   </button>
                 </li>`,
               )
               .join('')}
           </ul>`
        : ''
    }
    <button class="btn btn--primary" id="studio-new" style="margin-top:1rem;">Procesar otra canción</button>
  `;

  // Player de segmentos virtuales: seek a start, pausa en end
  const segAudio = body.querySelector('#studio-vocal-seg');
  if (segAudio) {
    let endAt = null;
    segAudio.addEventListener('timeupdate', () => {
      if (endAt !== null && segAudio.currentTime >= endAt) {
        segAudio.pause();
        endAt = null;
      }
    });
    body.querySelectorAll('.studio-seg').forEach((btn) => {
      btn.addEventListener('click', () => {
        segAudio.currentTime = Number(btn.dataset.start);
        endAt = Number(btn.dataset.end);
        void segAudio.play();
      });
    });
  }
  body.querySelector('#studio-new').addEventListener('click', () => renderIdle(body, quota));
}
```

- [ ] **Step 4: Registrar ruta en `src/main.js`** (después del bloque de `/recomendador`, ~línea 210)

```js
  guardedRoute('/estudio', async () => {
    hideFilterBar();
    const { renderStudioPage } = await import('./components/StudioPage.js');
    renderStudioPage(mainContent);
  });
```

(El import dinámico mantiene el bundle inicial liviano, mismo patrón que `/afinador`.)

- [ ] **Step 5: Agregar al menú en `src/components/AuthButton.js`** (después de la línea 35, item Recomendador)

```js
      <a class="auth-menu__item" href="#/estudio">${icon('audio-lines', { size: 16 })} Estudio <span class="badge--beta">BETA</span></a>
```

- [ ] **Step 6: Verificar que pasan + suite completa**

```bash
pnpm vitest run tests/studioPage.test.js
pnpm vitest run
```
Expected: PASS, sin regresiones.

- [ ] **Step 7: Commit**

```bash
git add src/components/StudioPage.js src/main.js src/components/AuthButton.js tests/studioPage.test.js
git commit -m "feat(estudio): página #/estudio con upload, polling y resultados"
```

---

### Task 13: Env vars, smoke real y cierre

- [ ] **Step 1: Configurar secretos**

```bash
# Generar y setear en Vercel (production + preview):
vercel env add REPLICATE_API_TOKEN     # token de replicate.com/account
vercel env add REPLICATE_WEBHOOK_SECRET  # de https://api.replicate.com/v1/webhooks/default/secret
vercel env add CRON_SECRET             # openssl rand -hex 32
vercel env add PUBLIC_BASE_URL         # https://hgmlyrics.vercel.app
vercel env pull .env.local             # para dev local
```

Obtener el webhook secret real:
```bash
curl -s -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  https://api.replicate.com/v1/webhooks/default/secret
```

- [ ] **Step 2: Verificación final local**

```bash
pnpm lint && pnpm test:ci && pnpm build
```
Expected: lint limpio, tests verdes con coverage ≥ umbral, build OK.

- [ ] **Step 3: Smoke real en preview (cuesta centavos)**

```bash
git push -u origin feat/estudio-stems   # dispara deploy de preview en Vercel
```
En el deploy de preview: login → `#/estudio` → subir un audio corto (~30 s) → verificar:
1. Upload directo OK (Network: PUT a supabase).
2. Stepper avanza a "Separando voces" y luego a resultados (~2-4 min).
3. Los 6 players de pistas suenan; líder/coros suenan; los segmentos saltan al timestamp.
4. `vercel logs` sin errores en webhook.
5. Forzar un fallo (subir un mp3 corrupto renombrado) → estado failed amigable y cuota intacta.

- [ ] **Step 4: PR**

```bash
gh pr create --title "feat: Estudio de pistas (separación de stems y voces)" --body "$(cat <<'EOF'
## Summary
- Nueva página #/estudio (BETA): sube un audio y recibe 6 stems + voz dividida (líder/coros + segmentos por cantante)
- Pipeline en Replicate (2 etapas) orquestado con webhooks firmados; resultados efímeros 48h; cuota 3/día
- Cron de limpieza horario; spec en docs/superpowers/specs/2026-06-03-separacion-stems-voces-design.md (local)

## Test plan
- [ ] pnpm test:ci verde
- [ ] Smoke en preview con audio real (pasos en el plan Task 13)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review (hecho al escribir el plan)

1. **Spec coverage:** tabla+bucket (T1), máquina de estados/cuota/validación (T2), Replicate+firma (T3), registry (T4), storage (T5), POST/GET jobs (T6), pipeline (T7-T8), estado+reconciliación+start (T9), cron+vercel.json (T10), cliente (T11), página+ruta+menú+5 estados UI (T12), env+smoke (T13). Segmentos virtuales reflejados en spec actualizado. ✓
2. **Placeholders:** los dos `REEMPLAZAR/CON-SLUG-VERIFICADO` de Task 4 son deliberados y el task EXIGE resolverlos dentro del propio task (Step 1 da los comandos de verificación); no se avanza con ellos pendientes. Resto sin TBDs. ✓
3. **Consistencia de tipos:** `voices.segments = [{voice,start,end}]` igual en `_models.parseOutput`, `_process`, y `StudioPage`; `predictions = {stems,karaoke,diarization}` consistente en start/webhook/[id]; estados idénticos a `NEXT` del dominio; `quota = {used,limit}` igual en API y página. ✓
