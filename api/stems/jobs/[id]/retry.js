import sql from '../../../_lib/db.js';
import { requireUser } from '../../../_lib/auth.js';
import { allowMethods, withErrors } from '../../../_lib/http.js';
import { signStemsDownload, createStemsSignedPutUrl } from '../../../_lib/storage.js';
import { invokeModalPipeline } from '../../../_lib/modal.js';
import { SECTION_KEYS, SECTION_OUTPUTS, deriveJobStatus } from '../../_sections.js';

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST'])) return;
  const user = await requireUser(req);
  const { id } = req.query;
  const section = req.query.section;

  // Guardia temprana — sin secreto todos los callbacks de Modal fallan en silencio.
  if (!process.env.MODAL_WEBHOOK_SECRET) {
    const e = new Error('MODAL_WEBHOOK_SECRET no configurado');
    e.status = 500;
    throw e;
  }

  // Validar que la sección es una key conocida.
  if (!SECTION_KEYS.includes(section)) {
    res.status(400).json({ error: 'Sección inválida' });
    return;
  }

  const rows = await sql`
    SELECT * FROM stem_jobs WHERE id = ${id} AND user_id = ${user.id}
  `;
  if (rows.length === 0) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }
  const job = rows[0];

  // Reintentar una sección failed o reanudar una skipped → running.
  const currentStatus = job.sections?.[section]?.status;
  if (currentStatus !== 'failed' && currentStatus !== 'skipped') {
    res.status(409).json({ error: `La sección no se puede reintentar (estado: ${currentStatus})` });
    return;
  }

  // Re-firmar la URL de descarga del input para que Modal pueda leerlo.
  let inputGetUrl;
  try {
    inputGetUrl = await signStemsDownload(job.input_path, 3600);
  } catch {
    res.status(400).json({ error: 'El archivo de origen no está disponible.' });
    return;
  }

  // Construir nuevas sections: copia superficial, solo la sección objetivo pasa a running.
  const sections = {
    ...job.sections,
    [section]: { ...job.sections[section], status: 'running', error: null },
  };

  // Persistir estado de reinicio (processing). Si la sección venía skipped,
  // añadirla a enabled_sections para mantener el registro consistente con las secciones activas.
  const enabledSet = new Set(job.enabled_sections ?? []);
  enabledSet.add(section);
  const nextEnabled = SECTION_KEYS.filter((k) => enabledSet.has(k));

  await sql`
    UPDATE stem_jobs
    SET status = 'processing',
        sections = ${sql.json(sections)},
        enabled_sections = ${sql.array(nextEnabled)},
        updated_at = now()
    WHERE id = ${job.id}
  `;

  // Pre-firmar uploads y lanzar Modal para la sección retried.
  try {
    const tracks = SECTION_OUTPUTS[section];
    let uploads;
    if (!tracks || tracks.length === 0) {
      // structure: no genera archivos de audio
      uploads = { [section]: {} };
    } else {
      const trackUrls = {};
      for (const track of tracks) {
        const key = `${user.id}/${job.id}/${section}/${track}.mp3`;
        trackUrls[track] = await createStemsSignedPutUrl(key);
      }
      uploads = { [section]: trackUrls };
    }

    const base =
      process.env.PUBLIC_BASE_URL ?? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
    const webhookUrl = `${base}/api/stems/webhook`;

    await invokeModalPipeline({
      jobId: job.id,
      input: { getUrl: inputGetUrl },
      enabledSections: [section],
      uploads,
      webhook: {
        url: webhookUrl,
        secret: process.env.MODAL_WEBHOOK_SECRET,
      },
    });
  } catch (err) {
    // Revertir la sección a failed y recomputar el estado del job.
    // Nota: enabled_sections se conserva tras el fallo — el usuario pidió habilitar esta sección,
    // así que queda como failed-pero-habilitada (reintentable), no se revierte a skipped.
    const reverted = {
      ...sections,
      [section]: { ...sections[section], status: 'failed', error: String(err?.message ?? err) },
    };
    await sql`
      UPDATE stem_jobs
      SET status = ${deriveJobStatus(reverted)},
          sections = ${sql.json(reverted)},
          error = ${String(err?.message ?? err)},
          updated_at = now()
      WHERE id = ${job.id}
    `;
    throw err;
  }

  res.status(200).json({ ok: true });
});
