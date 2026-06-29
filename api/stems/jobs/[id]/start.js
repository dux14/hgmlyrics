import sql from '../../../_lib/db.js';
import { requireUser } from '../../../_lib/auth.js';
import { allowMethods, withErrors } from '../../../_lib/http.js';
import { signStemsDownload, createStemsSignedPutUrl } from '../../../_lib/storage.js';
import { invokeModalPipeline } from '../../../_lib/modal.js';
import { initSections, SECTION_KEYS, SECTION_OUTPUTS, validateEnabledSections } from '../../_sections.js';

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST'])) return;
  const user = await requireUser(req);
  const { id } = req.query;

  // Fix 3: guardia temprana — sin secreto todos los callbacks de Modal fallan en silencio.
  if (!process.env.MODAL_WEBHOOK_SECRET) {
    const e = new Error('MODAL_WEBHOOK_SECRET no configurado');
    e.status = 500;
    throw e;
  }

  const rows = await sql`
    SELECT * FROM stem_jobs WHERE id = ${id} AND user_id = ${user.id}
  `;
  if (rows.length === 0) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }
  const job = rows[0];
  if (job.status !== 'created') {
    res.status(409).json({ error: `El job ya está en estado ${job.status}` });
    return;
  }

  // Verificar que el input existe: si signStemsDownload lanza, el archivo no se subió.
  let inputGetUrl;
  try {
    inputGetUrl = await signStemsDownload(job.input_path, 3600);
  } catch {
    res.status(400).json({ error: 'El archivo no terminó de subirse. Intenta de nuevo.' });
    return;
  }

  // ── 1. Secciones habilitadas ────────────────────────────────────────────────
  // El cliente elige qué secciones procesar (mínimo 1). Sin selección explícita,
  // se procesan las 4 (compatibilidad con el flujo anterior).
  // STUDIO_GENDER_FLAG: 'off' apaga gender sin redeploy.
  const genderEnabled = process.env.STUDIO_GENDER_FLAG !== 'off';
  const raw = req.body?.enabledSections;
  if (raw !== undefined && !Array.isArray(raw)) {
    res.status(400).json({ error: 'enabledSections debe ser un arreglo' });
    return;
  }
  const requested = Array.isArray(raw) ? raw : SECTION_KEYS;
  const enabledSections = validateEnabledSections(requested, { genderEnabled });

  const sections = initSections(enabledSections);

  // ── 2. Persistir estado inicial (processing) ────────────────────────────────
  // Fix 1: usar sql.array() para serializar text[] correctamente en Postgres.
  await sql`
    UPDATE stem_jobs
    SET status = 'processing',
        sections = ${sql.json(sections)},
        enabled_sections = ${sql.array(enabledSections)},
        updated_at = now()
    WHERE id = ${job.id} AND status = 'created'
  `;

  // ── 3. Pre-firmar URLs de upload (PUT) por sección y track ─────────────────
  // Fix 2: si algo falla aquí o en Modal, marcar el job como failed.
  try {
    const uploads = {};
    for (const section of enabledSections) {
      // gender usa estructura anidada por modelo: { chorus: {male,female}, aufr33: {male,female} }
      if (section === 'gender') {
        const genderModels = ['chorus', 'aufr33'];
        const genderTracks = ['male', 'female'];
        const genderUrls = {};
        for (const model of genderModels) {
          genderUrls[model] = {};
          for (const track of genderTracks) {
            const key = `${user.id}/${job.id}/gender/${model}/${track}.mp3`;
            genderUrls[model][track] = await createStemsSignedPutUrl(key);
          }
        }
        uploads[section] = genderUrls;
        continue;
      }
      const tracks = SECTION_OUTPUTS[section];
      if (!tracks || tracks.length === 0) {
        // structure: sin outputs de audio
        uploads[section] = {};
        continue;
      }
      const trackUrls = {};
      for (const track of tracks) {
        const key = `${user.id}/${job.id}/${section}/${track}.mp3`;
        trackUrls[track] = await createStemsSignedPutUrl(key);
      }
      uploads[section] = trackUrls;
    }

    // ── 4. URL del webhook ──────────────────────────────────────────────────────
    const base =
      process.env.PUBLIC_BASE_URL ?? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
    const webhookUrl = `${base}/api/stems/webhook`;

    // ── 5. Invocar orquestador Modal ────────────────────────────────────────────
    await invokeModalPipeline({
      jobId: job.id,
      input: { getUrl: inputGetUrl },
      enabledSections,
      uploads,
      webhook: {
        url: webhookUrl,
        secret: process.env.MODAL_WEBHOOK_SECRET,
      },
    });
  } catch (err) {
    // Marcar el job como failed para que no quede atascado en processing.
    await sql`
      UPDATE stem_jobs
      SET status = 'failed',
          error = ${String(err?.message ?? err)},
          updated_at = now()
      WHERE id = ${job.id}
    `;
    throw err;
  }

  res.status(200).json({ ok: true });
});
