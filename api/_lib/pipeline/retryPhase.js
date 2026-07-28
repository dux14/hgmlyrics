// Nucleo reusable del reintento de una fase failed/stale del run activo
// (extraido de api/songs/[id]/pipeline/retry.js, Tarea 3 de la Entrega 2).
// Lo usan tanto el endpoint manual (auto:false) como el reintento automatico
// (auto:true, Tareas 4/5): ambos DEBEN pasar por el mismo claim transaccional
// con FOR UPDATE y por canStartPhase, porque son las dos protecciones que
// evitan el loop infinito con una fase 'stale' (run 'failed' terminal no
// reabrible + canStartPhase en false mientras la letra esta reabierta).
import { canStartPhase, retriesLeft, runStatusFromPhases } from './state.js';
import { dispatchPhase } from '../../songs/[id]/pipeline/_dispatch.js';

/**
 * @param {object} sql - cliente postgres.js (o tx) inyectado por el llamador.
 * @param {{ songId: string, phase: string, auto: boolean }} args - `auto` decide
 *   si el claim tambien consume el contador automatico de la fase y el breaker
 *   del run (`song_pipeline_runs.auto_retries`); el manual solo consume `retries`.
 * @returns {Promise<{ ok: true } | { ok?: false, status: number, error: string }>}
 */
export async function retryPhase(sql, { songId, phase, auto }) {
  // Leer-validar-claim en una sola tx con FOR UPDATE: evita el TOCTOU del
  // UPDATE ciego anterior (sin predicado de estado, y `claimed.count===0`
  // como código muerto que nunca detectaba nada). El SELECT, la validación de
  // failed/stale y de dependencias (canStartPhase), y el UPDATE a 'running'
  // quedan atómicos bajo el lock de fila.
  const claim = await sql.begin(async (tx) => {
    const rows = await tx`
      SELECT id, song_id AS "songId", status, phases, input_path AS "inputPath"
      FROM song_pipeline_runs
      WHERE song_id = ${songId}
        AND status IN ('created', 'uploading', 'processing', 'awaiting_lyrics', 'running')
      ORDER BY created_at DESC LIMIT 1
      FOR UPDATE
    `;
    if (rows.length === 0) {
      return { status: 404, error: 'No hay una ejecución activa para esta canción' };
    }
    const run = rows[0];

    const currentPhase = run.phases[phase];
    const current = currentPhase?.status;
    if (current !== 'failed' && current !== 'stale') {
      return {
        status: 409,
        error: `La fase '${phase}' no está en failed/stale (está en ${current})`,
      };
    }

    // Tope de 3 reintentos por fase: chequeo y el incremento de abajo quedan
    // atómicos bajo el mismo FOR UPDATE (evita el TOCTOU de un incremento
    // fuera de la tx con requests concurrentes).
    if (retriesLeft(currentPhase) <= 0) {
      return { status: 409, error: 'Reintentos agotados' };
    }

    // canStartPhase exige status pending|stale — 'failed' se resetea primero, y
    // recién sobre ese estado se valida el DAG (evita re-despachar sin las
    // dependencias listas).
    const pendingPhases = structuredClone(run.phases);
    pendingPhases[phase] = {
      status: 'pending',
      error: null,
      tracks: undefined,
      artifacts: undefined,
      retries: currentPhase.retries || 0,
    };
    if (!canStartPhase(pendingPhases, phase)) {
      return { status: 409, error: `Las dependencias de '${phase}' no están listas` };
    }

    const runningPhases = structuredClone(pendingPhases);
    runningPhases[phase].status = 'running';
    runningPhases[phase].retries = (runningPhases[phase].retries || 0) + 1;
    // Un reintento automático consume AMBOS contadores de fase: si solo
    // consumiera `autoRetries`, el presupuesto MANUAL (3) quedaría intacto y
    // un run podría gastar hasta 5 GPUs por fase entre retries manuales y
    // automáticos.
    if (auto) {
      runningPhases[phase].autoRetries = (currentPhase.autoRetries || 0) + 1;
    }

    // 'structure' (SongFormer) viaja en el mismo dispatch que 'stems': si se
    // reintenta stems, SongFormer se vuelve a ejecutar, así que la fase tiene
    // que salir de su estado terminal o applyPhaseEvent descartaría el webhook
    // por fase terminal y la canción quedaría sin estructura detectada. Si ya
    // había completado bien, se respeta: el UPSERT de song_structure no
    // necesita recomputarse y volver a 'running' solo haría parpadear la UI.
    if (phase === 'stems' && runningPhases.structure?.status !== 'done') {
      runningPhases.structure = { ...runningPhases.structure, status: 'running', error: null };
    }

    // next_retry_at = NULL: el reintento (manual o automático) ya está en
    // curso, así que no hace falta que el cron lo vuelva a levantar. El
    // incremento de auto_retries del run (breaker) va en el mismo UPDATE, bajo
    // el mismo FOR UPDATE, para que el breaker no tenga TOCTOU.
    if (auto) {
      await tx`
        UPDATE song_pipeline_runs
        SET phases = ${tx.json(runningPhases)}, auto_retries = auto_retries + 1,
            next_retry_at = NULL, updated_at = now()
        WHERE id = ${run.id}
      `;
    } else {
      await tx`
        UPDATE song_pipeline_runs SET phases = ${tx.json(runningPhases)}, next_retry_at = NULL, updated_at = now()
        WHERE id = ${run.id}
      `;
    }

    return { ok: true, run, runningPhases };
  });

  if (!claim.ok) {
    return claim;
  }
  const { run, runningPhases } = claim;

  try {
    // isRetry:true -> pitch fuerza reset:true hacia hkn-pitch (ver
    // _dispatch.js): sin esto el jobId (=run.id) ya visto por Modal en el
    // dispatch inicial devuelve el callId cacheado en vez de relanzar.
    await dispatchPhase(phase, { ...run, phases: runningPhases }, { isRetry: true });
  } catch (err) {
    // Mismo criterio que confirm.js: solo la fase queda failed, el run sigue
    // 'processing' (retry-able de nuevo). Transaccional con FOR UPDATE por si
    // el estado cambió entre el claim y este fallo de dispatch.
    await sql.begin(async (tx) => {
      const rows = await tx`SELECT phases FROM song_pipeline_runs WHERE id = ${run.id} FOR UPDATE`;
      if (rows.length === 0) return;
      const fresh = rows[0].phases;
      if (fresh[phase]?.status !== 'running') return;
      const failedPhases = structuredClone(fresh);
      // Igual que advance.js/confirm.js: si el dispatch abortó por timeout, el
      // job pudo haber arrancado igual en Modal; el mensaje se lo dice al
      // admin para que no dispare otro reintento a ciegas (GPU doble).
      const error = err?.timeout
        ? `${String(err?.message ?? err).slice(0, 180)} El job pudo haber arrancado en Modal igual; si termina, su resultado se aplica solo.`.slice(
            0,
            300,
          )
        : String(err?.message ?? err).slice(0, 300);
      // Preserva tracks/artifacts ya publicados por esa fase (fix HIGH 1,
      // auditoría 27-jul): un UPDATE ciego con solo {status,error,retries}
      // borraba `phases.stems.tracks`, y DEPS.transcription/DEPS.pitch
      // (state.js) miran el track, no el status -- sin él, canStartPhase
      // queda en false para siempre y el run es irrecuperable sin tocar la DB.
      failedPhases[phase] = {
        ...fresh[phase],
        status: 'failed',
        error,
        retries: fresh[phase]?.retries || 0,
      };
      // Mismo criterio que confirm.js: si el reintento era de 'stems' y
      // 'structure' quedó en 'running' (mismo dispatch, nunca se disparó),
      // se marca failed en vez de dejarla colgada hasta el cron de zombis.
      if (phase === 'stems' && fresh.structure?.status === 'running') {
        failedPhases.structure = {
          ...fresh.structure,
          status: 'failed',
          error: 'No se pudo iniciar la detección de secciones',
        };
      }
      // Si esta fase es critica y ya agoto sus reintentos, el run entero debe
      // quedar 'failed' (Task 11): sin esto un run con una fase critica
      // muerta seguia 'processing' para siempre, bloqueando la cancion (1
      // run activo por cancion).
      const status = runStatusFromPhases(failedPhases);
      await tx`
        UPDATE song_pipeline_runs SET phases = ${tx.json(failedPhases)}, status = ${status}, updated_at = now()
        WHERE id = ${run.id}
      `;
    });
    // Tarea 4: acá va la llamada a maybeAutoRetry (programa o dispara el
    // próximo reintento automático según shouldAutoRetry).
    return { status: 502, error: 'No se pudo reintentar la fase. Intenta de nuevo.' };
  }

  return { ok: true };
}
