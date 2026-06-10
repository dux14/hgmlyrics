/**
 * _process.js — Avance del pipeline cuando una predicción termina.
 * Compartido por webhook.js (camino feliz) y jobs/[id].js (reconciliación).
 * La ingestión (descarga/upload) y el arranque de modelos van por el provider.
 */
import { MODELS } from './_models.js';
import { startModel, providerFor, ingestResult } from './_provider.js';
import { signStemsDownload } from '../_lib/storage.js';
import { canTransition, expiresAt } from '../_lib/stems.js';

const FRIENDLY_FAIL = 'El procesamiento falló. Intenta de nuevo (no consumió tu cuota).';

function webhookUrl(jobId, kind) {
  const base = process.env.PUBLIC_BASE_URL ?? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
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
        `[stems] job=${job.id} kind=${kind} provider=${provider} ${prediction.status}: ${prediction.error ?? '(sin detalle)'}`
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
    // Etapa 2: karaoke + diarización en paralelo sobre el stem vocal
    // TODO: re-firmar al reproducir si el TTL no cubre las 48h
    const vocalUrl = await signStemsDownload(stems.vocals, 21600);
    const [karaoke, diarization] = await Promise.all([
      startModel({ kind: 'karaoke', input: MODELS.karaoke.buildInput(vocalUrl), jobId: job.id, userId: job.user_id, callbackUrl: webhookUrl(job.id, 'karaoke') }),
      startModel({ kind: 'diarization', input: MODELS.diarization.buildInput(vocalUrl), jobId: job.id, userId: job.user_id, callbackUrl: webhookUrl(job.id, 'diarization') }),
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
  // FIX-1: merge atómico con jsonb || para evitar lost-update entre las 2 predicciones concurrentes.
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
