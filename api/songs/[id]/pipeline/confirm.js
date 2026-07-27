// Confirma la subida directa del mp3 completo de un run 'created' (spec Task
// B2): valida que el objeto exista en Storage y no exceda el límite, marca la
// fase 'upload' como done, pasa el run a 'processing' y despacha 'stems'.
import sql from '../../../_lib/db.js';
import { requireAdmin } from '../../../_lib/auth.js';
import { allowMethods, withErrors } from '../../../_lib/http.js';
import { pipelineInputStat } from '../../../_lib/storage.js';
import { applyPhaseEvent } from '../../../_lib/pipeline/state.js';
import { dispatchPhase } from './_dispatch.js';

const MAX_INPUT_BYTES = 25 * 1024 * 1024; // 25MB

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST'])) return;
  await requireAdmin(req, sql);
  const songId = req.query.id;
  if (!songId || typeof songId !== 'string') {
    res.status(400).json({ error: 'id es obligatorio' });
    return;
  }

  const rows = await sql`
    SELECT id, song_id AS "songId", status, phases, input_path AS "inputPath"
    FROM song_pipeline_runs
    WHERE song_id = ${songId} AND status = 'created'
    ORDER BY created_at DESC LIMIT 1
  `;
  if (rows.length === 0) {
    res.status(404).json({ error: 'No hay una ejecución pendiente de confirmar' });
    return;
  }
  const run = rows[0];

  // Chequeo server-side: el PUT firmado no rechaza por sí solo un archivo que
  // supere el límite, y el cliente pudo cancelar la subida a mitad de camino.
  const stat = await pipelineInputStat(run.inputPath);
  if (!stat.exists) {
    res.status(422).json({ error: 'El archivo no existe en el almacenamiento' });
    return;
  }
  if (stat.size !== null && stat.size > MAX_INPUT_BYTES) {
    res.status(422).json({ error: 'El archivo excede el límite de 25MB' });
    return;
  }

  // 'upload' arranca en 'running' (initialPhases) y nunca es terminal antes de
  // este punto, así que applyPhaseEvent nunca devuelve null aquí.
  const phases = applyPhaseEvent(run.phases, { phase: 'upload', ok: true });

  // El dispatch de 'stems' arranca en Modal las 4 secciones de separación Y
  // SongFormer (fase 'structure'): ambas quedan 'running' en el mismo CAS,
  // igual que hace advanceNextPhase con las fases que dispara. Sin esto la UI
  // pintaba "En espera" durante los ~3 minutos de GPU (H5 de la auditoría del
  // 24-jul) y el cron de zombis no podía detectarlas colgadas.
  phases.stems = { ...phases.stems, status: 'running' };
  phases.structure = { ...phases.structure, status: 'running' };

  // La duración se lee en el browser (readAudioDuration) y viaja best-effort:
  // si falta o es inválida no tumba el confirm, solo se pierde el dato (el
  // swap del approve queda con duration_sec null, igual que hoy).
  const { durationSec } = req.body ?? {};
  const hasValidDuration = typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec >= 0;

  // CAS: solo confirma si el run sigue en 'created' (cierra la carrera de
  // doble-confirm/doble-dispatch, mismo criterio que audio.js/approve.js).
  const claimed = hasValidDuration
    ? await sql`
        UPDATE song_pipeline_runs SET status = 'processing', phases = ${sql.json(phases)},
          input_meta = COALESCE(input_meta, '{}'::jsonb) || ${sql.json({ durationSec })}::jsonb,
          updated_at = now()
        WHERE id = ${run.id} AND status = 'created'
      `
    : await sql`
        UPDATE song_pipeline_runs SET status = 'processing', phases = ${sql.json(phases)}, updated_at = now()
        WHERE id = ${run.id} AND status = 'created'
      `;
  if (claimed.count === 0) {
    res.status(409).json({ error: 'La ejecución ya fue confirmada' });
    return;
  }

  // Dispatch aislado con 1 reintento (mismo patrón que pitch/jobs/[id]/approve.js).
  try {
    await dispatchPhase('stems', { ...run, phases });
  } catch (_err1) {
    try {
      await dispatchPhase('stems', { ...run, phases });
    } catch (err2) {
      // Decisión (carry del review plan A): runStatusFromPhases NO deriva
      // 'failed' global — el run se queda 'processing' (retry-able vía
      // retry.js) y SOLO la fase 'stems' pasa a failed. No hay auto-failed
      // de todo el run: sería YAGNI y además rompería el reintento sin volver
      // a subir el archivo.
      // Igual que advance.js: un timeout (err2.timeout) no prueba que Modal no
      // arrancó el job — el mensaje avisa al admin para que no reintente a
      // ciegas y pague GPU doble; si el job sigue vivo, el webhook rescata la
      // fase (ver isLateSuccessRescue en state.js).
      const error = err2?.timeout
        ? `${String(err2?.message ?? err2).slice(0, 180)} El job pudo haber arrancado en Modal igual; si termina, su resultado se aplica solo.`.slice(0, 300)
        : String(err2?.message ?? err2).slice(0, 300);
      const failedPhases = applyPhaseEvent(phases, {
        phase: 'stems',
        ok: false,
        error,
      });
      // 'structure' viajaba en el mismo dispatch: si este no salió, tampoco se
      // ejecuta. Se marca failed (es best-effort: la UI la pinta como pending y
      // retry.js no la acepta) para no dejarla en 'running' eternamente.
      failedPhases.structure = {
        ...failedPhases.structure,
        status: 'failed',
        error: 'No se pudo iniciar la detección de secciones',
      };
      await sql`
        UPDATE song_pipeline_runs SET phases = ${sql.json(failedPhases)}, updated_at = now()
        WHERE id = ${run.id}
      `;
      const e = new Error('No se pudo iniciar el procesamiento. Intenta de nuevo.');
      e.status = 502;
      throw e;
    }
  }
  res.status(200).json({ success: true });
});
