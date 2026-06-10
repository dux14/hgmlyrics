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
  const base =
    process.env.PUBLIC_BASE_URL ?? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
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
      stems[name] = await copyUrlToStems(url, `${job.user_id}/${job.id}/stems/${name}.mp3`);
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
    // TODO: re-firmar al reproducir si el TTL no cubre las 48h
    const vocalUrl = await signStemsDownload(stems.vocals, 21600);
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
  // FIX-1: merge atómico con jsonb || para evitar lost-update entre las 2 predicciones concurrentes.
  if (job.status !== 'separating_voices') return;

  let patch;
  if (kind === 'karaoke') {
    // Idempotencia: si ya llegó karaoke, no reescribir
    if (job.voices?.lead !== undefined) return;
    const out = MODELS.karaoke.parseOutput(prediction.output);
    const lead = out.lead
      ? await copyUrlToStems(out.lead, `${job.user_id}/${job.id}/voices/lead.mp3`)
      : null;
    const backing = out.backing
      ? await copyUrlToStems(out.backing, `${job.user_id}/${job.id}/voices/backing.mp3`)
      : null;
    patch = { lead, backing };
  } else {
    // kind === 'diarization'
    // Idempotencia: si ya llegó diarización, no reescribir
    if (job.voices?.segments !== undefined) return;
    patch = { segments: MODELS.diarization.parseOutput(prediction.output) };
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
