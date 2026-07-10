// Webhook de callback para el forced alignment (WhisperX en Modal). Espeja la
// firma HMAC de api/stems/webhook.js. Contrato:
//  - exito: { songId, lines: [{i, startMs}, ...], provider }
//  - error: { songId, error }
import sql from '../_lib/db.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { verifyModalSignature } from '../_lib/modal.js';
import { projectCanonicalLines } from '../_lib/align.js';

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
// cada item necesita {i: entero >=0 sin duplicar, i < canonicalCount} y
// startMs entero >=0 estrictamente creciente en el orden del array.
// Devuelve un mensaje de error (string) si es invalido, o null si es valido.
function validateLines(lines, canonicalCount) {
  const seen = new Set();
  let prevStartMs = -1;
  for (const item of lines) {
    const { i, startMs } = item ?? {};
    if (!Number.isInteger(i) || i < 0) {
      return `i invalido: ${i}`;
    }
    if (i >= canonicalCount) {
      return `i fuera de rango (${i} >= ${canonicalCount})`;
    }
    if (seen.has(i)) {
      return `i duplicado: ${i}`;
    }
    seen.add(i);
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
  const { songId, lines, provider, error } = payload;

  if (!songId || typeof songId !== 'string') {
    res.status(400).json({ error: 'Parámetro songId requerido' });
    return;
  }
  if (error === undefined && !Array.isArray(lines)) {
    res.status(400).json({ error: 'Parámetro lines (array) o error requerido' });
    return;
  }

  if (error !== undefined) {
    await sql`
      UPDATE song_line_timings
      SET status = 'failed', error = ${String(error).slice(0, 300)}
      WHERE song_id = ${songId}
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
      WHERE song_id = ${songId}
    `;
    // Estructuralmente valido el request, semanticamente invalidos los datos:
    // no es un error del caller, no reintenta Modal con un 4xx.
    res.status(200).json({ status: 'failed' });
    return;
  }

  await sql`
    UPDATE song_line_timings
    SET status = 'ready', lines = ${sql.json(lines)}, provider = ${provider ?? null}, error = NULL
    WHERE song_id = ${songId}
  `;
  res.status(200).json({ status: 'ready' });
});
