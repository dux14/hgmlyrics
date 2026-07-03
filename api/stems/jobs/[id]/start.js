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
  // Fix 1 (TOCTOU de cuota): transición atómica created -> processing. El WHERE
  // status='created' + RETURNING hace que, si dos /start corren en paralelo para
  // el mismo job, solo uno gane la fila; el perdedor recibe 0 filas y NO debe
  // invocar Modal (evita disparar 2 jobs GPU). No se re-consulta con un SELECT
  // aparte: eso reintroduciría el TOCTOU que este UPDATE atómico cierra.
  // Fix 1: usar sql.array() para serializar text[] correctamente en Postgres.
  const claimed = await sql`
    UPDATE stem_jobs
    SET status = 'processing',
        sections = ${sql.json(sections)},
        enabled_sections = ${sql.array(enabledSections)},
        updated_at = now()
    WHERE id = ${job.id} AND status = 'created'
    RETURNING id
  `;
  if (claimed.length === 0) {
    res.status(409).json({ error: 'El job ya no se puede iniciar (ya está en proceso).' });
    return;
  }

  // ── 3. Pre-firmar URLs de upload (PUT) por sección y track ─────────────────
  // Fix 2: si algo falla aquí o en Modal, marcar el job como failed.
  // Perf: hasta 13 firmados independientes (PUT signing es HTTP suelto, sin pool) —
  // se resuelven todos en paralelo con Promise.all, preservando la forma sección→track→url.
  try {
    const sectionEntries = await Promise.all(
      enabledSections.map(async (section) => {
        // gender usa estructura anidada por modelo: { chorus: {male,female}, aufr33: {male,female} }
        if (section === 'gender') {
          const genderModels = ['chorus', 'aufr33'];
          const genderTracks = ['male', 'female'];
          const signed = await Promise.all(
            genderModels.flatMap((model) =>
              genderTracks.map(async (track) => {
                const key = `${user.id}/${job.id}/gender/${model}/${track}.mp3`;
                return { model, track, url: await createStemsSignedPutUrl(key) };
              }),
            ),
          );
          const genderUrls = {};
          for (const { model, track, url } of signed) {
            genderUrls[model] = genderUrls[model] ?? {};
            genderUrls[model][track] = url;
          }
          return [section, genderUrls];
        }
        const tracks = SECTION_OUTPUTS[section];
        if (!tracks || tracks.length === 0) {
          // structure: sin outputs de audio
          return [section, {}];
        }
        const trackEntries = await Promise.all(
          tracks.map(async (track) => {
            const key = `${user.id}/${job.id}/${section}/${track}.mp3`;
            return [track, await createStemsSignedPutUrl(key)];
          }),
        );
        return [section, Object.fromEntries(trackEntries)];
      }),
    );
    const uploads = Object.fromEntries(sectionEntries);

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
