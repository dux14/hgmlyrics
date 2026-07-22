// stemsAdapter.js — traduce el webhook por sección de la app Modal hkn-stems
// (shape { jobId, section, result:{status,model,outputs|segments}, error } —
// ver post_webhook en modal/sections/_common.py) al phase-event que consume
// applyPipelinePhaseEvent (api/pipeline/webhook.js). Traduce a DOS fases
// distintas del DAG: 'stems' (secciones voiceInstrumental/leadBacking/gender)
// y 'structure' (sección homónima, SongFormer). Función PURA (sin sql/fetch)
// para poder testear la traducción en unidad.

// leadBacking es la única sección que carga los tracks críticos del DAG
// (vocals/lead/backing, ver STEM_KINDS en songs/[id]/pipeline/_dispatch.js):
// es la finalizadora de la fase stems. El resto (voiceInstrumental, gender)
// aporta tracks best-effort, sin poder cerrar ni fallar la fase.
const FINALIZER_SECTION = 'leadBacking';

/**
 * @param {{jobId:string, section:string,
 *          result?:{status:string, model?:string, outputs?:object}, error?:string}} body
 * @returns {{runId:string, phase:'stems', ok:boolean, partial?:boolean,
 *            tracks?:object, error?:string} | null}
 *   Solo se contemplan status 'done'/'failed' (enum cerrado). null si el
 *   evento debe ignorarse: status ausente o desconocido (p.ej. 'running') —
 *   aun no hay resultado, no debe finalizar ni fallar la fase — o sección no
 *   finalizadora que falló (no crítica para el DAG, p.ej. gender opcional o
 *   voiceInstrumental sin slot de upload en modo unificado).
 */
function sectionResultToStemsEvent(jobId, section, result, error) {
  const outputs = result.outputs || {};
  const tracks = Object.fromEntries(Object.entries(outputs).filter(([, v]) => v !== null && v !== undefined));
  const isFinalizer = section === FINALIZER_SECTION;

  if (result.status === 'failed') {
    if (!isFinalizer) return null;
    return { runId: jobId, phase: 'stems', ok: false, error: error ?? 'error desconocido' };
  }

  if (result.status !== 'done') return null;

  return isFinalizer
    ? { runId: jobId, phase: 'stems', ok: true, partial: false, tracks }
    : { runId: jobId, phase: 'stems', ok: true, partial: true, tracks };
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
