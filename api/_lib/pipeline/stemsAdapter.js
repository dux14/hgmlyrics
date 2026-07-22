// stemsAdapter.js — traduce el webhook por sección de la app Modal hkn-stems
// (shape { jobId, section, result:{status,model,outputs|segments}, error } —
// ver post_webhook en modal/sections/_common.py) al phase-event que consume
// applyPipelinePhaseEvent (api/pipeline/webhook.js). Traduce a DOS fases
// distintas del DAG: 'stems' (secciones voiceInstrumental/leadBacking/gender/
// duet) y 'structure' (sección homónima, SongFormer). Función PURA (sin sql/
// fetch) para poder testear la traducción en unidad.
import { STEM_KINDS } from '../../stems/_sections.js';

// leadBacking es la única sección que carga los tracks críticos del DAG
// (vocals/lead/backing, ver STEM_KINDS en api/stems/_sections.js): es la
// finalizadora de la fase stems. El resto (voiceInstrumental, gender, duet)
// aporta tracks best-effort, sin poder cerrar ni fallar la fase.
const FINALIZER_SECTION = 'leadBacking';

/**
 * Aplana un nivel de anidamiento en `outputs` (fix review Task 6: gender.py
 * postea `outputs.chorus = {male, female}` anidado por nombre de modelo —
 * sin aplanar, `tracks` quedaba con una sola entrada `kind='chorus'` cuyo
 * valor era un objeto, y `song_stems.kind` no admite 'chorus' en su CHECK →
 * INSERT rechazado, rollback de toda la tx, gender nunca publicaba). General
 * a propósito (no hardcodea "chorus"): cualquier valor-objeto se eleva a
 * entradas planas kind→storageKey. `duet` (voice_a/voice_b) ya sube flat, no
 * le afecta.
 * @param {object} outputs
 * @returns {object}
 */
function flattenOutputs(outputs) {
  const tracks = {};
  for (const [kind, value] of Object.entries(outputs)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') {
      for (const [nestedKind, nestedValue] of Object.entries(value)) {
        if (nestedValue !== null && nestedValue !== undefined) tracks[nestedKind] = nestedValue;
      }
    } else {
      tracks[kind] = value;
    }
  }
  return tracks;
}

/**
 * @param {{jobId:string, section:string,
 *          result?:{status:string, model?:string, outputs?:object, durationSec?:number}, error?:string}} body
 * @returns {{runId:string, phase:'stems', ok:boolean, partial?:boolean,
 *            tracks?:object, durationSec?:number, error?:string} | null}
 *   Solo se contemplan status 'done'/'failed' (enum cerrado). null si el
 *   evento debe ignorarse: status ausente o desconocido (p.ej. 'running') —
 *   aun no hay resultado, no debe finalizar ni fallar la fase — o sección no
 *   finalizadora que falló (no crítica para el DAG, p.ej. gender opcional o
 *   voiceInstrumental sin slot de upload en modo unificado).
 */
function sectionResultToStemsEvent(jobId, section, result, error) {
  const flat = flattenOutputs(result.outputs || {});
  // Filtra por STEM_KINDS (fix review Task 6): cada sección solo publica los
  // kinds que le corresponden en song_stems — p.ej. voiceInstrumental sube
  // 'vocals' como copia de trabajo (ver UPLOAD_SLOTS en _dispatch.js) pero NO
  // la publica; la fuente canónica de tracks.vocals es leadBacking. Antes de
  // este fix, la única barrera contra esa publicación era el orden temporal
  // S1→S3 del DAG (Task 9 la va a romper al paralelizar).
  const allowedKinds = STEM_KINDS[section];
  const tracks = allowedKinds
    ? Object.fromEntries(Object.entries(flat).filter(([kind]) => allowedKinds.includes(kind)))
    : flat;
  const isFinalizer = section === FINALIZER_SECTION;

  if (result.status === 'failed') {
    if (!isFinalizer) return null;
    return { runId: jobId, phase: 'stems', ok: false, error: error ?? 'error desconocido' };
  }

  if (result.status !== 'done') return null;

  // durationSec (Task 7): S1/S3 calculan la duración del audio de entrada
  // decodificado (len(samples)/sr) y la postean junto a outputs/model. Se
  // propaga tal cual al phase-event solo si vino en el result — process.js
  // decide si la persiste (best-effort del browser tiene prioridad si ya
  // está seteada, ver applyPipelinePhaseEvent).
  const durationSec = typeof result.durationSec === 'number' ? result.durationSec : undefined;

  return isFinalizer
    ? {
        runId: jobId,
        phase: 'stems',
        ok: true,
        partial: false,
        tracks,
        ...(durationSec !== undefined && { durationSec }),
      }
    : {
        runId: jobId,
        phase: 'stems',
        ok: true,
        partial: true,
        tracks,
        ...(durationSec !== undefined && { durationSec }),
      };
}

/**
 * @returns {{runId:string, phase:'structure', ok:boolean, partial?:boolean,
 *            payload?:{segments:object[], model:string|null}, error?:string} | null}
 *   A diferencia de gender/voiceInstrumental (best-effort: al fallar se
 *   ignoran con null), structure failed SI produce un evento visible —
 *   es una fila con retry en el stepper, aunque no bloquee el `done` del run
 *   (runStatusFromPhases no la exige). Los segments de SongFormer llegan en
 *   segundos (start/end float); la conversión a startMs/endMs enteros ocurre
 *   SOLO acá, una única vez — downstream ya trabaja en ms.
 */
function sectionResultToStructureEvent(jobId, result, error) {
  if (result.status === 'failed') {
    return { runId: jobId, phase: 'structure', ok: false, error: error ?? 'error desconocido' };
  }
  if (result.status !== 'done') return null;

  const segments = (result.segments ?? []).map((s) => ({
    label: s.label,
    startMs: Math.round(s.start * 1000),
    endMs: Math.round(s.end * 1000),
  }));
  return {
    runId: jobId,
    phase: 'structure',
    ok: true,
    partial: false,
    payload: { segments, model: result.model ?? null },
  };
}

export function sectionEventToPhaseEvent(body) {
  const { jobId, section, result = {}, error } = body;
  if (section === 'structure') return sectionResultToStructureEvent(jobId, result, error);
  return sectionResultToStemsEvent(jobId, section, result, error);
}
