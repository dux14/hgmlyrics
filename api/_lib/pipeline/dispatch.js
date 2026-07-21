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
 * transcription: función hkn-align/transcribe (Task B5, `modal/align_app.py`
 * `run_transcribe` + endpoint `transcribe`). Payload EXACTO del contrato real
 * (ver `_validate_transcribe_payload`): { runId, vocalsGetUrl, dbLines,
 * canonicalLines?, webhookUrl, snapshotHash? }. `dbLines` es obligatorio (la
 * función Modal rechaza el payload si viene vacío). Calca fetch/headers de
 * align.js; reusa MODAL_INBOUND_SECRET (misma familia que stems/align).
 * @param {{ run:{id:string, songId:string}, vocalsGetUrl:string,
 *           dbLines:string[], canonicalLines?:string[], snapshotHash?:string,
 *           webhookUrl:string }} args
 * @returns {Promise<{id:string}>}
 */
export async function dispatchTranscribe({ run, vocalsGetUrl, dbLines, canonicalLines, snapshotHash, webhookUrl }) {
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
        runId: run.id,
        vocalsGetUrl,
        dbLines,
        canonicalLines,
        webhookUrl,
        snapshotHash,
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
 * `snapshotHash` (fase derivada de la letra, plan C) viaja dentro de `input`
 * para que `run_pipeline` la re-postee tal cual al webhook — `process.js` la
 * lee top-level del body que postea Modal.
 * @param {{ run:{id:string, songId:string, profile?:string}, leadGetUrl:string,
 *           backingGetUrl:string, snapshotHash?:string, webhookUrl:string }} args
 * @returns {Promise<{id:string}>}
 */
export async function dispatchPitch({ run, leadGetUrl, backingGetUrl, snapshotHash, webhookUrl }) {
  return invokePitchPipeline({
    jobId: run.id,
    profile: run.profile ?? 'default',
    input: { leadGetUrl, backingGetUrl, snapshotHash },
    uploads: {},
    webhook: { url: webhookUrl },
  });
}

/**
 * clips: función hkn-clips (Task B6, `modal/clips_app.py` `run_clips` +
 * endpoint `start`). Payload EXACTO del contrato real (ver docstring del
 * módulo + `_validate_clips_payload`): { runId, webhookUrl, snapshotHash?,
 * stems:[{kind,getUrl}], lines:[{i,startMs}], lineSections:[int], totalMs,
 * uploads:{kind:{sectionIndex:putUrl}}, uploadKeys:{kind:{sectionIndex:key}} }.
 * `lineSections`/`totalMs` dependen del snapshot de letra aprobado (plan C,
 * aún no existe) — ver CONCERN en `_dispatch.js`. Reusa MODAL_INBOUND_SECRET
 * (mismo concern que transcribe).
 * @param {{ run:{id:string, songId:string}, stems:Array<{kind:string,getUrl:string}>,
 *           lines:Array<{i:number,startMs:number}>, lineSections:number[],
 *           totalMs:number, uploads:object, uploadKeys:object,
 *           snapshotHash?:string, webhookUrl:string }} args
 * @returns {Promise<{id:string}>}
 */
export async function dispatchClips({
  run, stems, lines, lineSections, totalMs, uploads, uploadKeys, snapshotHash, webhookUrl,
}) {
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
        runId: run.id,
        webhookUrl,
        snapshotHash,
        stems,
        lines,
        lineSections,
        totalMs,
        uploads,
        uploadKeys,
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
