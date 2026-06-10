/**
 * _provider.js — Enruta cada kind a Replicate o Modal y normaliza la ingestión.
 * La máquina de estados vive en _process.js; acá solo "quién arranca" y "output → keys".
 */
import { MODELS } from './_models.js';
import { createPrediction } from '../_lib/replicate.js';
import { createModalJob } from '../_lib/modal.js';
import { copyUrlToStems } from '../_lib/storage.js';

/** @param {'stems'|'karaoke'|'diarization'} kind @returns {'replicate'|'modal'} */
export function providerFor(kind) {
  // Override por-kind solo para karaoke a propósito: MDX23 (karaoke) es el modelo de riesgo
  // alto, así que puede quedarse en Replicate (STEMS_PROVIDER_KARAOKE=replicate) mientras
  // stems/diarization van a Modal. Los otros kinds siguen el global STEMS_PROVIDER.
  const override = kind === 'karaoke' ? process.env.STEMS_PROVIDER_KARAOKE : undefined;
  const p = override ?? process.env.STEMS_PROVIDER ?? 'replicate';
  return p === 'modal' ? 'modal' : 'replicate';
}

/**
 * Arranca un modelo con el proveedor correcto.
 * @param {{ kind:string, input:object, jobId:string, userId:string, callbackUrl:string }} args
 * @returns {Promise<{ id:string }>}
 */
export async function startModel({ kind, input, jobId, userId, callbackUrl }) {
  if (providerFor(kind) === 'modal') {
    return createModalJob({ kind, input, jobId, userId, callbackUrl });
  }
  return createPrediction({ model: MODELS[kind].slug, input, webhook: callbackUrl });
}

/**
 * Normaliza el output de una predicción a storage keys.
 * - Replicate: parseOutput → copia URLs al bucket → keys.
 * - Modal: el output ya trae keys (excepto diarization, que viene RAW → parseOutput).
 * @returns para stems `{name:key}`, karaoke `{lead,backing}`, diarization `[{voice,start,end}]`
 */
export async function ingestResult({ kind, provider, prediction, job }) {
  if (provider === 'modal') {
    if (kind === 'diarization') return MODELS.diarization.parseOutput(prediction.output);
    if (!prediction.output || typeof prediction.output !== 'object') {
      throw Object.assign(new Error('Modal: output ausente en callback succeeded'), { status: 502 });
    }
    return prediction.output; // stems / karaoke: keys passthrough
  }
  // Replicate
  if (kind === 'stems') {
    const urls = MODELS.stems.parseOutput(prediction.output);
    const stems = {};
    for (const [name, url] of Object.entries(urls)) {
      if (!url) continue;
      stems[name] = await copyUrlToStems(url, `${job.user_id}/${job.id}/stems/${name}.mp3`);
    }
    return stems;
  }
  if (kind === 'karaoke') {
    const out = MODELS.karaoke.parseOutput(prediction.output);
    return {
      lead: out.lead ? await copyUrlToStems(out.lead, `${job.user_id}/${job.id}/voices/lead.mp3`) : null,
      backing: out.backing ? await copyUrlToStems(out.backing, `${job.user_id}/${job.id}/voices/backing.mp3`) : null,
    };
  }
  return MODELS.diarization.parseOutput(prediction.output);
}
