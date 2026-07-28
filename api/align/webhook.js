// Webhook de callback para el forced alignment (WhisperX en Modal). Espeja la
// firma HMAC de api/stems/webhook.js. Contrato:
//  - exito: { songId, lines: [{i, startMs}, ...], provider, beats: {bpm, beatsMs}|null, snapshotHash? }
//  - error: { songId, error, snapshotHash? }
// snapshotHash es opcional: solo lo manda run_align cuando dispatchAlign lo
// recibió (fase `sync` del pipeline unificado). Karaoke standalone no lo
// manda, y este webhook lo reenvía tal cual al phase-event de sync.
import sql from '../_lib/db.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { verifyModalSignature } from '../_lib/modal.js';
import { projectCanonicalLines } from '../_lib/align.js';
import { validateBeats } from '../_lib/beats.js';
import { applyPipelinePhaseEvent } from '../_lib/pipeline/process.js';
import { ADVANCE_AFTER, advanceNextPhase } from '../_lib/pipeline/advance.js';
import { canStartPhase } from '../_lib/pipeline/state.js';

// Puente hacia el run unificado (pipeline por canción): este webhook es el
// LEGACY de alineamiento standalone, pero cuando la fase `sync` de un run está
// corriendo, este es el único callback que sabe si el align terminó. Sin este
// puente `sync` queda 'running' para siempre y el run nunca completa (Critical
// #3 del code-review). Si no hay run activo (align standalone, sin pipeline)
// no hace nada — preserva el flujo legacy intacto.
// Tras aplicar el evento, dispara el avance a `clips` (mismo criterio que
// api/pipeline/webhook.js): applyPipelinePhaseEvent ya devuelve `next` solo
// cuando el evento se aplicó de verdad (ni ignored ni stale), y canStartPhase
// exige sync 'done' para clips — un sync fallido nunca llega a avanzar.
async function notifyPipelineSync(songId, ok, error, snapshotHash) {
  try {
    const [run] = await sql`
      SELECT id, phases FROM song_pipeline_runs
      WHERE song_id = ${songId} AND status IN ('created', 'uploading', 'processing', 'awaiting_lyrics', 'running')
      ORDER BY created_at DESC LIMIT 1
    `;
    // Acepta 'running' Y 'failed' (fix HIGH 3, auditoría 27-jul): si el
    // dispatch de sync hizo timeout del lado de Vercel pero el job SÍ corrió
    // en Modal, la fase queda 'failed' aunque el resultado llegue completo y
    // exitoso -- filtrar solo por 'running' descartaba ese rescate antes de
    // que applyPhaseEvent/isLateSuccessRescue (state.js) pudiera evaluarlo, y
    // 'sync' quedaba fallida para siempre. applyPipelinePhaseEvent decide: un
    // evento parcial o fallido sobre una fase ya 'failed' se sigue ignorando.
    if (!run || !['running', 'failed'].includes(run.phases?.sync?.status)) return;
    const outcome = await applyPipelinePhaseEvent(sql, run.id, { phase: 'sync', ok, error, snapshotHash });
    const advance = outcome?.next && ADVANCE_AFTER.sync;
    if (advance && canStartPhase(outcome.next, advance)) {
      await advanceNextPhase(sql, run.id, songId, advance);
    }
  } catch (e) {
    console.error('notifyPipelineSync falló:', e);
  }
}

// Raw body necesario para verificar la firma HMAC.
// maxDuration 60: este webhook también dispara advanceNextPhase→dispatchAlign
// hacia `clips`, que ahora espera hasta MODAL_DISPATCH_TIMEOUT_MS (30s) por el
// dispatch a Modal — 30s de presupuesto total no dejaba margen para el resto
// del handler (verificación HMAC, updates de DB antes/después del dispatch).
export const config = {
  api: { bodyParser: false },
  maxDuration: 60,
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Valida la estructura de `lines` contra la proyeccion canonica de la cancion:
// cada item necesita {i: entero >=0 ascendente sin duplicar, i < canonicalCount}
// y startMs entero >=0 estrictamente creciente en el orden del array. El orden
// ascendente de `i` es un invariante que el front asume (seekSyncToLine corta
// el scan al primer i mayor), asi que se valida en esta frontera de confianza.
// Devuelve un mensaje de error (string) si es invalido, o null si es valido.
function validateLines(lines, canonicalCount) {
  let prevI = -1;
  let prevStartMs = -1;
  for (const item of lines) {
    const { i, startMs } = item ?? {};
    if (!Number.isInteger(i) || i < 0) {
      return `i invalido: ${i}`;
    }
    if (i >= canonicalCount) {
      return `i fuera de rango (${i} >= ${canonicalCount})`;
    }
    if (i <= prevI) {
      return `i no ascendente: ${i}`;
    }
    prevI = i;
    if (!Number.isInteger(startMs) || startMs < 0) {
      return `startMs invalido para i=${i}: ${startMs}`;
    }
    if (startMs <= prevStartMs) {
      return `startMs no estrictamente creciente en i=${i}`;
    }
    prevStartMs = startMs;
  }
  return null;
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST'])) return;

  const body = await readRawBody(req);

  const ok = verifyModalSignature({
    timestamp: req.headers['x-modal-timestamp'],
    signature: req.headers['x-modal-signature'],
    body,
    secret: process.env.MODAL_WEBHOOK_SECRET,
  });
  if (!ok) {
    res.status(401).json({ error: 'Firma de webhook inválida' });
    return;
  }

  const payload = JSON.parse(body);
  const { songId, lines, provider, error, beats, snapshotHash } = payload;

  if (!songId || typeof songId !== 'string') {
    res.status(400).json({ error: 'Parámetro songId requerido' });
    return;
  }
  if (error === undefined && !Array.isArray(lines)) {
    res.status(400).json({ error: 'Parámetro lines (array) o error requerido' });
    return;
  }

  // Guard de transicion en los tres UPDATE: solo se pisa una fila que sigue en
  // 'processing'. Si el admin edito secciones con el job en vuelo (PUT marca
  // 'stale') o re-subio el mp3 (nuevo ciclo pending→processing), el resultado
  // tardio del job viejo NO debe clobberear ese estado mas nuevo.
  if (error !== undefined) {
    await sql`
      UPDATE song_line_timings
      SET status = 'failed', error = ${String(error).slice(0, 300)}
      WHERE song_id = ${songId} AND status = 'processing'
    `;
    await notifyPipelineSync(songId, false, String(error).slice(0, 300), snapshotHash);
    res.status(200).json({ status: 'failed' });
    return;
  }

  const [song] = await sql`SELECT sections FROM songs WHERE id = ${songId}`;
  const canonicalCount = projectCanonicalLines(song?.sections).length;

  const validationError = validateLines(lines, canonicalCount);
  if (validationError) {
    await sql`
      UPDATE song_line_timings
      SET status = 'failed', error = ${`Timings inválidos: ${validationError}`.slice(0, 300)}
      WHERE song_id = ${songId} AND status = 'processing'
    `;
    await notifyPipelineSync(
      songId,
      false,
      `Timings inválidos: ${validationError}`.slice(0, 300),
      snapshotHash,
    );
    // Estructuralmente valido el request, semanticamente invalidos los datos:
    // no es un error del caller, no reintenta Modal con un 4xx.
    res.status(200).json({ status: 'failed' });
    return;
  }

  // beats es best-effort: a diferencia de lines, invalido no tumba el webhook
  // ni marca failed, solo se descarta (el metronomo cae a un fallback sin
  // rejilla detectada).
  const beatsError = validateBeats(beats ?? null);
  if (beatsError) {
    console.warn(`Beats inválidos (ignorados): ${beatsError}`);
  }
  const validBeats = beats && !beatsError ? beats : null;
  // Shape explicito: solo bpm/beatsMs viajan al JSONB, aunque Modal mande
  // claves extra en el payload.
  const beatsRow = validBeats ? { bpm: validBeats.bpm, beatsMs: validBeats.beatsMs } : null;

  // score/interpolated son best-effort, igual que beats: a diferencia de
  // i/startMs (ya validados arriba, tumban el webhook si son invalidos), su
  // ausencia o invalidez nunca descarta el timing de la linea, solo esos dos
  // campos caen a un default neutro. Shape explicito por linea: solo estas
  // cuatro claves viajan al JSONB, aunque Modal mande claves extra.
  const linesRow = lines.map((l) => ({
    i: l.i,
    startMs: l.startMs,
    score: typeof l.score === 'number' && l.score >= 0 && l.score <= 1 ? l.score : null,
    interpolated: l.interpolated === true,
  }));

  await sql`
    UPDATE song_line_timings
    SET status = 'ready', lines = ${sql.json(linesRow)}, provider = ${provider ?? null}, error = NULL,
        bpm_detected = ${beatsRow ? beatsRow.bpm : null}, beats = ${beatsRow ? sql.json(beatsRow) : null}
    WHERE song_id = ${songId} AND status = 'processing'
  `;
  await notifyPipelineSync(songId, true, undefined, snapshotHash);
  res.status(200).json({ status: 'ready' });
});
