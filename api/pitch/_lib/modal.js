import { fetchWithTimeout, MODAL_DISPATCH_TIMEOUT_MS } from '../../_lib/http.js';

/**
 * Invoca run_pipeline del app Modal hkn-pitch. Secrets propios de Partitura.
 * `runId` (opcional, pipeline unificado): id real de song_pipeline_runs para
 * correlacionar el webhook de vuelta cuando `jobId` viaja versionado por
 * ciclo de letra (`${run.id}:${snapshotHash}`, ver dispatchPitch) — sin esto
 * pitch_app.py postearía el jobId versionado como `runId` del webhook y
 * process.js no encontraría la fila (`WHERE id = ${runId}`).
 * @param {{ jobId:string, runId?:string, profile:string, input:{getUrl:string},
 *           uploads:object, webhook:{url:string}, reset?:boolean }} payload
 * @returns {Promise<{ id:string }>}
 */
export async function invokePitchPipeline(payload) {
  const endpoint = process.env.PITCH_MODAL_ENDPOINT;
  const secret = process.env.PITCH_MODAL_INBOUND_SECRET;
  if (!endpoint || !secret) {
    const e = new Error('PITCH_MODAL_ENDPOINT / PITCH_MODAL_INBOUND_SECRET no configurados');
    e.status = 500;
    throw e;
  }
  const res = await fetchWithTimeout(
    endpoint,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-inbound-secret': secret },
      body: JSON.stringify({ fn: 'run_pipeline', ...payload }) },
    { timeoutMs: MODAL_DISPATCH_TIMEOUT_MS, label: 'Modal (pitch)' },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const e = new Error(`Modal ${res.status}: ${detail.slice(0, 200)}`);
    e.status = 502;
    throw e;
  }
  return { id: (await res.json()).callId };
}
