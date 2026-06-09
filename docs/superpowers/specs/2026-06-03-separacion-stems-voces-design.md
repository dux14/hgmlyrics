# Estudio de pistas — Separación de stems y voces (diseño)

> Fecha: 2026-06-03 · Estado: aprobado en brainstorming, pendiente plan de implementación
> Enfoque elegido: **A — Orquestación serverless en Vercel + Replicate con webhooks**

## 1. Resumen

Nueva página `#/estudio` ("Estudio de pistas", badge Beta) donde un usuario logueado sube un
archivo de audio (MP3/WAV/M4A) y recibe, en ~2-5 min:

1. **Etapa 1 — Stems**: la canción separada en 6 pistas (voz, batería, bajo, guitarra, piano,
   otros), con prioridad de calidad en la pista vocal.
2. **Etapa 2 — Voces**: la pista vocal dividida en **voz líder vs coros** (armonías
   simultáneas) y en **segmentos etiquetados por cantante** (partes alternadas en el tiempo),
   porque el contenido típico mezcla ambos casos.

Los resultados son **efímeros**: expiran a las **48 h** y se borran automáticamente.

### Expectativa de fidelidad (decisión consciente)

La separación total de N voces cantando en armonía simultánea es frontera de investigación
(solo AudioShake la ofrece comercialmente). Lo realista hoy, y lo que entrega esta feature:

- Armonías simultáneas → **líder / coros** (alta calidad con modelos karaoke).
- Voces alternadas → **segmentos por cantante** vía diarización (funciona bien).
- La UI comunica esta expectativa explícitamente en los resultados.

Si tras validar se necesita más calidad, la evolución es un worker propio en Modal con
ensembles BS/Mel-RoFormer (Enfoque B) o AudioShake API (Enfoque C), sin tocar el frontend.

## 2. Decisiones de alcance

| Decisión | Valor |
|---|---|
| Audiencia | Usuarios logueados (Supabase Auth existente) |
| Resultado | Stems completos + voces (líder/coros + segmentos) |
| Tipo de voces soportado | Mezcla: armonía simultánea + alternadas |
| Infra GPU | Replicate, pay-per-use |
| Persistencia | Efímera: `expires_at = done + 48h` |
| Cuota | 3 canciones/día por usuario, 1 job activo a la vez |
| Límites de archivo | ≤ 25 MB, ~10 min, mime/extensión de audio |
| Costo estimado | ~USD $0.05–0.12 por canción de 4 min |

## 3. Arquitectura y flujo de datos

```
[Browser PWA]                    [Vercel api/]                [Replicate GPU]           [Supabase]
     │                                │                            │                       │
     │ 1. POST /api/stems/jobs ──────▶│ valida cuota (3/día) ──────│──────────────────────▶│ INSERT job
     │ ◀── signed upload URL ─────────│                            │                       │
     │ 2. sube audio directo ─────────│────────────────────────────│──────────────────────▶│ Storage (privado)
     │ 3. POST /api/stems/jobs/:id/start                           │                       │
     │                                │── etapa 1: 6-stem ────────▶│ separa stems          │
     │ 4. polling GET jobs/:id ──────▶│                            │                       │
     │                                │◀─ webhook stems listos ────│                       │
     │                                │── copia stems ─────────────│──────────────────────▶│ Storage
     │                                │── etapa 2a: karaoke ──────▶│ líder vs coros        │
     │                                │── etapa 2b: diarización ──▶│ segmentos por voz     │
     │                                │◀─ webhooks etapa 2 ────────│                       │
     │ 5. UI muestra resultados ◀─────│── copia voces ─────────────│──────────────────────▶│ Storage
     │    (players + descargas)       │                            │                       │
     │                                │ cron cada hora: borra jobs/archivos > 48h ────────▶│ DELETE
```

Puntos clave:

- **El audio nunca pasa por Vercel al subir**: el cliente sube directo a Supabase Storage con
  URL firmada (25 MB no caben cómodos en una función).
- **Model registry configurable**: una constante única (`api/stems/_models.js` o similar)
  mapea etapa → slug de modelo Replicate. Etapa 1: modelo 6-stem familia RoFormer si existe
  uno publicado de calidad; fallback `htdemucs_6s` (el motor de stemdeck). Etapa 2a: modelo
  karaoke (lead/backing vocals). Etapa 2b: diarización (pyannote). Los slugs exactos se
  validan al inicio de la implementación.
- **Webhooks de Replicate** mueven la máquina de estados; el frontend solo hace polling.
- **Cron de limpieza** cada hora vía `vercel.json` crons.

## 4. Backend

### Tabla `stem_jobs` (Postgres/Supabase)

```sql
stem_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,            -- Supabase Auth user
  status        text NOT NULL,            -- ver máquina de estados
  input_path    text,                     -- key en Storage del audio original
  input_meta    jsonb,                    -- { filename, size, duration, mime }
  stems         jsonb,                    -- { vocals, drums, bass, guitar, piano, other } → paths
  voices        jsonb,                    -- { lead, backing, segments: [{voice, start, end}] } (segmentos virtuales: timestamps sobre el stem vocal, sin archivo propio — cortar audio requeriría ffmpeg)
  predictions   jsonb,                    -- { stems: replicate_id, karaoke: id, diarization: id }
  error         text,                     -- mensaje amigable si falla
  created_at    timestamptz DEFAULT now(),
  expires_at    timestamptz               -- se fija al completar: done + 48h
)
```

### Máquina de estados

```
created → uploaded → separating_stems → separating_voices → done → expired (cron)
                            │                  │
                            └──── failed ◀─────┘
```

- Transiciones solo hacia adelante.
- `separating_voices` termina cuando AMBOS sub-jobs (karaoke + diarización) reportaron su
  webhook; el avance parcial vive en `predictions`.

### Endpoints (`api/stems/`) — siguen `withErrors`, `allowMethods`, `sql` singleton

| Endpoint | Método | Hace |
|---|---|---|
| `jobs.js` | POST | Auth usuario → valida cuota (≤3 hoy, sin job activo) → crea job + signed upload URL |
| `jobs.js` | GET | Lista jobs vigentes del usuario (retomar al volver a la página) |
| `jobs/[id].js` | GET | Estado del job + signed URLs de descarga si `done` (aquí pega el polling) |
| `jobs/[id]/start.js` | POST | Confirma upload OK → dispara etapa 1 en Replicate → `separating_stems` |
| `webhook.js` | POST | Webhooks Replicate (verifica firma) → copia outputs a Storage → avanza estado / dispara etapa 2. `maxDuration: 300` |
| `cleanup.js` | GET (cron) | Borra Storage + marca `expired` jobs > 48h; marca `failed` jobs en proceso > 30 min. Protegido con `CRON_SECRET` |

### Cuota y seguridad

- Auth: mismo verificador JWT de Supabase que los endpoints de perfil/social (`api/_lib/auth.js`).
- Cuota: `COUNT(*)` de jobs del usuario con `created_at > hoy 00:00` y `status != 'failed'`.
  **Los jobs fallidos no consumen cuota.**
- Bucket privado `stems-jobs/`; descargas siempre con signed URLs de 1 h. Nada público.
- Validación en POST: extensión/mime de audio, ≤ 25 MB. La duración (~10 min) la valida el
  cliente leyendo metadata; Replicate falla limpio si se pasa.
- Webhook: verificación de firma (`REPLICATE_WEBHOOK_SECRET`); sin firma válida → 401.
- Env vars nuevas (Vercel): `REPLICATE_API_TOKEN`, `REPLICATE_WEBHOOK_SECRET`, `CRON_SECRET`.

## 5. Frontend

### Página `#/estudio` — `src/components/StudioPage.js`

- Registrada en `main.js`, enlazada en el menú de navegación. Badge Beta (patrón Recomendador).
- Sin sesión → CTA de login.
- Mobile-first, flujo vertical único, tokens de diseño existentes.

### Estados de la UI

1. **Idle** - dropzone accesible (drag & drop + botón "elegir archivo"), copy con límites:
   "MP3, WAV, M4A · máx 25 MB / 10 min · 3 canciones por día". Muestra cuota restante.
2. **Subiendo** - barra de progreso del upload directo a Storage.
3. **Procesando** - stepper de 2 etapas ("Separando pistas… ~2 min" → "Separando voces… ~2 min"),
   polling cada 5 s, `aria-live` para lectores de pantalla. Se puede salir: al volver,
   `GET /api/stems/jobs` retoma el job activo.
4. **Listo** - dos grupos:
   - **Pistas**: voz, batería, bajo, guitarra, piano, otros - `<audio>` nativo + descargar.
   - **Voces**: líder, coros, y segmentos alternados etiquetados ("Voz 1: 0:42–1:10"). Los
     segmentos son virtuales: el player reproduce el rango [start, end] sobre el stem vocal
     (sin archivo por segmento). Nota de expectativas visible (armonías = líder/coros).
   - Countdown de expiración ("Disponible por 47 h") + "Descargar todo" (descargas
     secuenciales cliente; sin ZIP server-side).
5. **Falló** - mensaje amigable + reintentar (no consumió cuota).

## 6. Manejo de errores

- **Webhook perdido**: si el polling ve un job sin avance > 3 min, `GET jobs/:id` consulta la
  predicción directo a Replicate y reconcilia (el webhook es el camino feliz, no el único).
- **Job zombi**: el cron marca `failed` cualquier job en proceso > 30 min.
- **Upload interrumpido**: job queda en `created`/`uploaded` sin consumir cuota; el cron lo limpia.
- **Audio sin voz / resultado vacío**: se entrega igual con aviso ("no detectamos voces claras").
- **Fallo de Replicate**: `status = failed` con mensaje amigable; reintentar crea job nuevo.

## 7. Testing

- **Unit (Vitest)**: lógica de cuota, transiciones de la máquina de estados, handler del
  webhook con payloads mock de Replicate + verificación de firma, mapeo de segmentos de
  diarización.
- **Componente (jsdom)**: render de los 5 estados de la página, polling con fake timers.
- **Smoke manual documentado**: fixture de audio corto (~30 s) por el pipeline real en un
  deploy de preview antes de mergear (cuesta centavos).

## 8. Fuera de alcance (YAGNI explícito)

- ZIP server-side de resultados.
- Conversión WAV → MP3 de los outputs (se entregan como los devuelve el modelo).
- Separación real de N voces simultáneas (frontera; evolución futura vía Modal/AudioShake).
- Biblioteca persistente de resultados (los jobs expiran a las 48 h).
- Asociar resultados a canciones del wiki (posible fase futura).

## 9. Contexto de investigación

Investigación /last30days 2026-06-03 (raw: `~/Documents/Last30Days/ai-stem-separation-vocals-raw-v3.md`):

- SOTA 2026 voces: BS-RoFormer (11.30 dB SDR) y Mel-RoFormer; ensembles en MVSEP/UVR.
- Demucs (`htdemucs_6s`, 10K stars) sigue siendo el default open source (motor de stemdeck)
  pero el repo está estancado.
- Open source estándar NO separa cantantes individuales (Demucs issue #328, UVR discussion
  #885); solo AudioShake lo ofrece comercialmente (Multi-Speaker Separation, API).
- Papers: arXiv 2003.01531 (voice separation, unknown speakers), arXiv 2404.11275
  (speech/singing joint separation).
