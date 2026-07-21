// stemsAdapter.js — traduce el webhook por sección de la app Modal hkn-stems
// (shape { jobId, section, result:{status,model,outputs}, error } — ver
// post_webhook en modal/sections/_common.py) al phase-event de la fase
// 'stems' que consume applyPipelinePhaseEvent (api/pipeline/webhook.js).
// Función PURA (sin sql/fetch) para poder testear la traducción en unidad.

// leadBacking es la única sección que carga los tracks críticos del DAG
// (vocals/lead/backing, ver STEM_KINDS en songs/[id]/pipeline/_dispatch.js):
// es la finalizadora de la fase stems. El resto (voiceInstrumental, gender,
// structure) aporta tracks best-effort, sin poder cerrar ni fallar la fase.
const FINALIZER_SECTION = 'leadBacking';

/**
 * @param {{jobId:string, section:string,
 *          result?:{status:string, model?:string, outputs?:object}, error?:string}} body
 * @returns {{runId:string, phase:'stems', ok:boolean, partial?:boolean,
 *            tracks?:object, error?:string} | null}
 *   null si el evento debe ignorarse (sección no finalizadora que falló —
 *   no crítica para el DAG, p.ej. gender opcional o voiceInstrumental sin
 *   slot de upload en modo unificado).
 */
export function sectionEventToPhaseEvent(body) {
  const { jobId, section, result = {}, error } = body;
  const outputs = result.outputs || {};
  const tracks = Object.fromEntries(Object.entries(outputs).filter(([, v]) => v !== null && v !== undefined));

  if (section === FINALIZER_SECTION) {
    if (result.status === 'failed') {
      return { runId: jobId, phase: 'stems', ok: false, error: error ?? 'error desconocido' };
    }
    return { runId: jobId, phase: 'stems', ok: true, partial: false, tracks };
  }

  if (result.status === 'failed') return null;
  return { runId: jobId, phase: 'stems', ok: true, partial: true, tracks };
}
