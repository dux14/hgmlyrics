/**
 * _process.js — Avance del pipeline cuando una predicción termina.
 * Compartido por webhook.js (camino feliz) y jobs/[id].js (reconciliación).
 * La ingestión (descarga/upload) y el arranque de modelos van por el provider.
 */
import { MODELS } from './_models.js';
import { startModel, providerFor, ingestResult } from './_provider.js';
import { signStemsDownload } from '../_lib/storage.js';
import { canTransition, expiresAt } from '../_lib/stems.js';
import { SECTION_KEYS, applySectionResult, deriveJobStatus } from './_sections.js';

const FRIENDLY_FAIL = 'El procesamiento falló. Intenta de nuevo (no consumió tu cuota).';

function webhookUrl(jobId, kind) {
  const base =
    process.env.PUBLIC_BASE_URL ?? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  const suffix = providerFor(kind) === 'modal' ? '&provider=modal' : '';
  return `${base}/api/stems/webhook?job=${jobId}&kind=${kind}${suffix}`;
}

/**
 * Aplica el resultado de una predicción al job. Idempotente: si el job ya avanzó, no hace nada.
 * @param {import('postgres').Sql} sql
 * @param {object} job - fila actual de stem_jobs
 * @param {'stems'|'karaoke'|'diarization'} kind
 * @param {object} prediction - payload del provider { status, output, error }
 * @param {'replicate'|'modal'} [provider]
 */
export async function processPredictionResult(sql, job, kind, prediction, provider = 'replicate') {
  if (prediction.status !== 'succeeded') {
    if (['failed', 'canceled'].includes(prediction.status) && canTransition(job.status, 'failed')) {
      // El usuario ve FRIENDLY_FAIL, pero el detalle técnico del provider se pierde si no
      // lo logueamos: lo dejamos en los logs del servidor para poder depurar sin adivinar.
      console.error(
        `[stems] job=${job.id} kind=${kind} provider=${provider} ${prediction.status}: ${prediction.error ?? '(sin detalle)'}`,
      );
      await sql`
        UPDATE stem_jobs SET status = 'failed', error = ${FRIENDLY_FAIL}, updated_at = now()
        WHERE id = ${job.id} AND status = ${job.status}
      `;
    }
    return;
  }

  if (kind === 'stems') {
    if (job.status !== 'separating_stems') return; // ya procesado (idempotencia)
    const stems = await ingestResult({ kind, provider, prediction, job });
    if (!stems.vocals) {
      await sql`
        UPDATE stem_jobs SET status = 'failed',
          error = 'No detectamos voces claras en este audio.', updated_at = now()
        WHERE id = ${job.id} AND status = 'separating_stems'
      `;
      return;
    }
    // Persistir el trabajo de GPU (la separación) ANTES de despachar la etapa 2. Si un
    // dispatch falla luego, los stems no se pierden ni el job queda clavado en
    // separating_stems hasta expirar: ese era el bug (UPDATE después del Promise.all).
    await sql`
      UPDATE stem_jobs SET status = 'separating_voices',
        stems = ${sql.json(stems)}, updated_at = now()
      WHERE id = ${job.id} AND status = 'separating_stems'
    `;
    // Etapa 2: karaoke + diarización sobre el stem vocal. Cada dispatch va aislado, así un
    // fallo no aborta al otro ni descarta los stems. El job ya está en separating_voices.
    // TODO: re-firmar al reproducir si el TTL no cubre las 48h
    const vocalUrl = await signStemsDownload(stems.vocals, 21600);
    const stage2 = { ...job, status: 'separating_voices', stems, voices: job.voices ?? null };
    await Promise.all([
      dispatchStage2(sql, stage2, 'karaoke', MODELS.karaoke.buildInput(vocalUrl)),
      dispatchStage2(sql, stage2, 'diarization', MODELS.diarization.buildInput(vocalUrl)),
    ]);
    return;
  }

  // kind === 'karaoke' | 'diarización' (etapa 2): llega el webhook con el resultado.
  if (job.status !== 'separating_voices') return;

  let patch;
  if (kind === 'karaoke') {
    // Idempotencia: si ya llegó karaoke, no reescribir
    if (job.voices?.lead !== undefined) return;
    patch = await ingestResult({ kind, provider, prediction, job }); // { lead, backing }
  } else {
    // kind === 'diarization'
    // Idempotencia: si ya llegó diarización, no reescribir
    if (job.voices?.segments !== undefined) return;
    patch = { segments: await ingestResult({ kind, provider, prediction, job }) };
  }

  await applyStage2Patch(sql, job, patch);
}

/**
 * Arranca un modelo reintentando una vez ante un fallo: cubre el 502 transitorio de
 * Replicate (p. ej. el GET de la versión del modelo) sin descartar trabajo ya hecho.
 */
async function startModelWithRetry(args) {
  try {
    return await startModel(args);
  } catch {
    return await startModel(args);
  }
}

/**
 * Despacha un modelo de etapa 2 de forma aislada. Si arranca, registra su prediction id;
 * si falla incluso tras el reintento, DEGRADA el job escribiendo un resultado vacío para
 * ese kind (karaoke → lead/backing null; diarización → segments []), de modo que el job
 * pueda llegar a 'done' con los stems + lo que sí corrió, sin tirar el trabajo de GPU.
 */
async function dispatchStage2(sql, job, kind, input) {
  try {
    const pred = await startModelWithRetry({
      kind,
      input,
      jobId: job.id,
      userId: job.user_id,
      callbackUrl: webhookUrl(job.id, kind),
    });
    await sql`
      UPDATE stem_jobs
        SET predictions = predictions || ${sql.json({ [kind]: pred.id })}, updated_at = now()
        WHERE id = ${job.id} AND status = 'separating_voices'
    `;
  } catch (err) {
    console.error(`[stems] job=${job.id} kind=${kind} dispatch falló, degradando: ${err.message}`);
    const patch = kind === 'karaoke' ? { lead: null, backing: null } : { segments: [] };
    await applyStage2Patch(sql, job, patch);
  }
}

/**
 * Aplica el resultado de una sección al job en una transacción con row-lock (FOR UPDATE).
 * Serializa escrituras concurrentes: Modal puede postear las 4 secciones simultáneamente.
 *
 * @param {import('postgres').Sql} sql
 * @param {string} jobId
 * @param {string} section - clave de SECTION_KEYS
 * @param {{ status:'done'|'failed', model?:string, outputs?:object, segments?:any[], error?:string }} result
 * @returns {Promise<{ status:string, sections:object }|null>} null si el job no existe
 */
export async function applySectionWebhook(sql, jobId, section, result) {
  if (!SECTION_KEYS.includes(section)) {
    const e = new Error(`Sección desconocida: ${section}`);
    e.status = 400;
    throw e;
  }

  return sql.begin(async (sql) => {
    // FOR UPDATE serializa las escrituras concurrentes de las 4 secciones del DAG.
    // Sin este lock, dos webhooks simultáneos podrían leer el mismo `sections` y
    // uno pisaría el resultado del otro (last-write-wins).
    const [job] = await sql`
      SELECT sections, status FROM stem_jobs WHERE id = ${jobId} FOR UPDATE
    `;
    if (!job) return null; // job desconocido

    const nextSections = applySectionResult(job.sections, section, result);
    const nextStatus = deriveJobStatus(nextSections);

    if (result.status === 'failed') {
      await sql`
        UPDATE stem_jobs
        SET sections = ${sql.json(nextSections)},
            status = ${nextStatus},
            error = ${result.error ?? 'section failed'},
            updated_at = now()
        WHERE id = ${jobId}
      `;
    } else {
      await sql`
        UPDATE stem_jobs
        SET sections = ${sql.json(nextSections)},
            status = ${nextStatus},
            updated_at = now()
        WHERE id = ${jobId}
      `;
    }

    return { status: nextStatus, sections: nextSections };
  });
}

/**
 * Aplica un patch de voices con merge atómico y, si ya están las dos partes (lead y
 * segments), transiciona el job a 'done'. Compartido por el camino de webhooks (etapa 2)
 * y por la degradación de un dispatch fallido.
 * FIX-1: el merge jsonb || evita lost-update entre las 2 predicciones concurrentes.
 */
async function applyStage2Patch(sql, job, patch) {
  // Merge atómico: solo aporta las claves propias, sin pisar las del otro webhook
  const [updated] = await sql`
    UPDATE stem_jobs
      SET voices = COALESCE(voices, '{}'::jsonb) || ${sql.json(patch)}, updated_at = now()
      WHERE id = ${job.id} AND status = 'separating_voices'
      RETURNING voices
  `;
  if (!updated) return; // race: el job ya salió de separating_voices

  const merged = updated.voices ?? {};
  const complete = merged.lead !== undefined && merged.segments !== undefined;
  if (complete) {
    await sql`
      UPDATE stem_jobs SET status = 'done', expires_at = ${expiresAt()}, updated_at = now()
      WHERE id = ${job.id} AND status = 'separating_voices'
    `;
  }
}
