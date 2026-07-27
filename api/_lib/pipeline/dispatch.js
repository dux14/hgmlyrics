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
import { fetchWithTimeout, MODAL_DISPATCH_TIMEOUT_MS } from '../http.js';
import { dispatchAlign } from '../align.js';

/**
 * stems: reusa el orquestador hkn-stems (MODAL_STEMS_ENDPOINT) vía
 * invokeModalPipeline — el payload {jobId,input,enabledSections,uploads,webhook}
 * es exactamente el mismo shape que start.js, invokeModalPipeline es agnóstico
 * al llamador. `enabledSections` la arma el caller (Task 6: las 5 secciones del
 * DAG — ver ENABLED_SECTIONS en songs/[id]/pipeline/_dispatch.js), no se
 * hardcodea aquí para que el pipeline unificado y el Estudio manual (start.js)
 * puedan pedir subconjuntos distintos.
 * @param {{ run:{id:string, songId:string, inputGetUrl:string}, uploads:object,
 *           enabledSections:string[], webhookUrl:string }} args
 * @returns {Promise<{id:string}>}
 */
export async function dispatchStems({ run, uploads, enabledSections, webhookUrl }) {
  return invokeModalPipeline({
    jobId: run.id,
    input: { getUrl: run.inputGetUrl },
    enabledSections,
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
    { timeoutMs: MODAL_DISPATCH_TIMEOUT_MS, label: 'Modal (transcribe)' },
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
 * `signUploadUrl` apunta al endpoint `api/pipeline/sign-upload.js` (Task 2):
 * el orquestador hkn-pitch lo necesita para firmar sus propios uploads, sin
 * esta clave revienta con KeyError del lado de Modal.
 * `reset`: jobId = run.id, estable entre el dispatch inicial (aprobación de
 * letra, lyrics.js) y un reintento explícito (retry.js) — sin `reset:true`,
 * `start()` de pitch_app.py encuentra el jobId ya en su Dict de idempotencia
 * (`_seen`) y devuelve el callId cacheado sin relanzar `run_pipeline`
 * (dedup:true), dejando la fase colgada en 'running' para siempre aunque el
 * job original ya haya muerto. Solo retry.js debe pasar `reset:true` (acción
 * deliberada del admin); el dispatch inicial deja el default `false` para
 * seguir protegiendo el doble-approve accidental de una facturación GPU doble.
 * `lines`/`language` (Task 2.3): letra aprobada del gate, aplanada por
 * `pipelineLinesFor` — la fuente única que `hkn-pitch` usa para forced align
 * en vez de transcribir por su cuenta (dos ASR independientes daban textos
 * distintos entre el gate y la partitura). Ambos opcionales: sin fila en
 * `song_pipeline_lyrics` (job standalone de `pitch_jobs`) el caller los deja
 * `undefined` y el modo actual de hkn-pitch queda intacto.
 * @param {{ run:{id:string, songId:string, profile?:string}, leadGetUrl:string,
 *           backingGetUrl:string, snapshotHash?:string,
 *           lines?:Array<{text:string,startMs:number,endMs:number}>,
 *           language?:string, webhookUrl:string, reset?:boolean }} args
 * @returns {Promise<{id:string}>}
 */
export async function dispatchPitch({
  run, leadGetUrl, backingGetUrl, snapshotHash, lines, language, webhookUrl, reset = false,
}) {
  return invokePitchPipeline({
    jobId: run.id,
    profile: run.profile ?? 'default',
    input: { leadGetUrl, backingGetUrl, snapshotHash, lines, language },
    uploads: {},
    signUploadUrl: `${process.env.PUBLIC_BASE_URL}/api/pipeline/sign-upload`,
    webhook: { url: webhookUrl },
    reset,
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
    { timeoutMs: MODAL_DISPATCH_TIMEOUT_MS, label: 'Modal (clips)' },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const e = new Error(`Modal ${res.status}: ${detail.slice(0, 200)}`);
    e.status = 502;
    throw e;
  }
  return { id: (await res.json()).callId };
}
