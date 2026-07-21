// dispatch.js — Despachos del pipeline unificado hacia Modal. Cada función
// recibe el run ya PERSISTIDO (el llamador hace el CAS de estado antes de
// invocar, igual que api/stems/jobs/[id]/start.js y api/pitch/jobs/[id]/approve.js)
// y arma el payload con signed URLs + webhook. Reusa los motores existentes:
// nada de fetch/HMAC nuevo para stems/pitch/sync, ya viven en modal.js /
// api/pitch/_lib/modal.js / align.js.
//
// Secreto del webhook: el HMAC de api/pipeline/webhook.js reusa
// MODAL_WEBHOOK_SECRET (los callbacks vienen de las mismas apps Modal
// hkn-stems / hkn-align / hkn-pitch que ya postean con ese secreto a sus
// webhooks actuales). No se introduce un secreto nuevo por sección.
import { invokeModalPipeline } from '../modal.js';
import { invokePitchPipeline } from '../../pitch/_lib/modal.js';
import { fetchWithTimeout } from '../http.js';
import { dispatchAlign } from '../align.js';

/**
 * stems: reusa el orquestador hkn-stems (MODAL_STEMS_ENDPOINT) vía
 * invokeModalPipeline — el payload {jobId,input,enabledSections,uploads,webhook}
 * es exactamente el mismo shape que start.js, invokeModalPipeline es agnóstico
 * al llamador. Solo se piden leadBacking + gender: la estructura la da la letra
 * (transcripción), no la separación de audio.
 * @param {{ run:{id:string, songId:string, inputGetUrl:string}, uploads:object,
 *           webhookUrl:string }} args
 * @returns {Promise<{id:string}>}
 */
export async function dispatchStems({ run, uploads, webhookUrl }) {
  return invokeModalPipeline({
    jobId: run.id,
    input: { getUrl: run.inputGetUrl },
    enabledSections: ['leadBacking', 'gender'],
    uploads,
    webhook: { url: webhookUrl, secret: process.env.MODAL_WEBHOOK_SECRET },
  });
}

/**
 * transcription: función NUEVA hkn-align/transcribe (Task B5). El endpoint aún
 * no existe (MODAL_TRANSCRIBE_ENDPOINT sin valor) — se referencia igual para
 * que el shape del payload quede listo. Calca fetch/headers de align.js;
 * reusa MODAL_INBOUND_SECRET (misma familia que stems/align, ver concern en el
 * reporte).
 * @param {{ run:{id:string, songId:string}, vocalsGetUrl:string, webhookUrl:string }} args
 * @returns {Promise<{id:string}>}
 */
export async function dispatchTranscribe({ run, vocalsGetUrl, webhookUrl }) {
  const endpoint = process.env.MODAL_TRANSCRIBE_ENDPOINT;
  const secret = process.env.MODAL_INBOUND_SECRET;
  if (!endpoint || !secret) {
    const e = new Error('MODAL_TRANSCRIBE_ENDPOINT / MODAL_INBOUND_SECRET no configurados');
    e.status = 500;
    throw e;
  }
  const res = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-inbound-secret': secret },
      body: JSON.stringify({
        fn: 'transcribe',
        jobId: run.id,
        songId: run.songId,
        audioUrl: vocalsGetUrl,
        webhookUrl,
      }),
    },
    { timeoutMs: 8000, label: 'Modal (transcribe)' },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const e = new Error(`Modal ${res.status}: ${detail.slice(0, 200)}`);
    e.status = 502;
    throw e;
  }
  return { id: (await res.json()).callId };
}

// sync: reusa dispatchAlign(songId) tal cual — ya persiste song_line_timings.
export { dispatchAlign };

/**
 * pitch: reusa hkn-pitch (PITCH_MODAL_ENDPOINT) vía invokePitchPipeline, que
 * es un passthrough agnóstico al shape de `input` (solo hace
 * JSON.stringify({fn:'run_pipeline', ...payload})). A diferencia de
 * api/pitch/jobs/[id]/approve.js (una sola pista `input.getUrl`), el pipeline
 * unificado ya separó lead/backing en la fase de stems, así que se mandan
 * ambas URLs firmadas.
 * @param {{ run:{id:string, songId:string, profile?:string}, leadGetUrl:string,
 *           backingGetUrl:string, webhookUrl:string }} args
 * @returns {Promise<{id:string}>}
 */
export async function dispatchPitch({ run, leadGetUrl, backingGetUrl, webhookUrl }) {
  return invokePitchPipeline({
    jobId: run.id,
    profile: run.profile ?? 'default',
    input: { leadGetUrl, backingGetUrl },
    uploads: {},
    webhook: { url: webhookUrl },
  });
}

/**
 * clips: función NUEVA hkn-clips (Task B6). El endpoint aún no existe
 * (MODAL_CLIPS_ENDPOINT sin valor) — se referencia igual para dejar el
 * payload listo. Reusa MODAL_INBOUND_SECRET (mismo concern que transcribe).
 * @param {{ run:{id:string, songId:string}, stems:object, sections:object,
 *           timings:object, uploads:object, webhookUrl:string }} args
 * @returns {Promise<{id:string}>}
 */
export async function dispatchClips({ run, stems, sections, timings, uploads, webhookUrl }) {
  const endpoint = process.env.MODAL_CLIPS_ENDPOINT;
  const secret = process.env.MODAL_INBOUND_SECRET;
  if (!endpoint || !secret) {
    const e = new Error('MODAL_CLIPS_ENDPOINT / MODAL_INBOUND_SECRET no configurados');
    e.status = 500;
    throw e;
  }
  const res = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-inbound-secret': secret },
      body: JSON.stringify({
        fn: 'render_clips',
        jobId: run.id,
        songId: run.songId,
        stems,
        sections,
        timings,
        uploads,
        webhookUrl,
      }),
    },
    { timeoutMs: 8000, label: 'Modal (clips)' },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const e = new Error(`Modal ${res.status}: ${detail.slice(0, 200)}`);
    e.status = 502;
    throw e;
  }
  return { id: (await res.json()).callId };
}
