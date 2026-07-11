// Webhook de callback para el forced alignment (WhisperX en Modal). Espeja la
// firma HMAC de api/stems/webhook.js. Contrato:
//  - exito: { songId, lines: [{i, startMs}, ...], provider, beats: {bpm, beatsMs}|null }
//  - error: { songId, error }
import sql from '../_lib/db.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { verifyModalSignature } from '../_lib/modal.js';
import { projectCanonicalLines } from '../_lib/align.js';
import { validateBeats } from '../_lib/beats.js';

// Raw body necesario para verificar la firma HMAC.
export const config = {
  api: { bodyParser: false },
  maxDuration: 30,
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
  const { songId, lines, provider, error, beats } = payload;

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

  await sql`
    UPDATE song_line_timings
    SET status = 'ready', lines = ${sql.json(lines)}, provider = ${provider ?? null}, error = NULL,
        bpm_detected = ${validBeats ? validBeats.bpm : null}, beats = ${validBeats ? sql.json(validBeats) : null}
    WHERE song_id = ${songId} AND status = 'processing'
  `;
  res.status(200).json({ status: 'ready' });
});
