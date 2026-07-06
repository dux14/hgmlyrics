import sql from '../_lib/db.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { timingSafeEqualStr } from '../_lib/crypto.js';
import { createPitchSignedPutUrl } from './_lib/storage.js';

// Llamado por el orquestador Modal (no por el usuario): entrega un PUT firmado
// hacia pitch-jobs para subir artefactos intermedios. Autenticado por secreto
// compartido (x-inbound-secret), no por sesión de usuario.
// `key` es RELATIVA a la carpeta del job (ej. "stems/lead.wav"): el nodo Modal
// solo conoce jobId, no user_id, así que el prefijo `${user_id}/${jobId}/` se
// resuelve aquí a partir del DB y se antepone antes de firmar.
export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST'])) return;

  const secret = process.env.PITCH_MODAL_INBOUND_SECRET || '';
  const provided = req.headers['x-inbound-secret'] || '';
  if (!secret || !timingSafeEqualStr(provided, secret)) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }

  const { jobId, key } = req.body ?? {};
  if (!jobId || !key) {
    res.status(400).json({ error: 'jobId/key requeridos' });
    return;
  }

  const rows = await sql`SELECT id, user_id, status FROM pitch_jobs WHERE id = ${jobId}`;
  if (rows.length === 0) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }

  if (rows[0].status !== 'running') {
    res.status(409).json({ error: 'El job no está en ejecución' });
    return;
  }

  if (!key.trim() || key.includes('..') || key.startsWith('/') || key.includes('//')) {
    res.status(400).json({ error: 'key inválida' });
    return;
  }

  const fullKey = `${rows[0].user_id}/${jobId}/${key}`;
  const url = await createPitchSignedPutUrl(fullKey);
  res.status(200).json({ url });
});
