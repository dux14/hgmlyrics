import sql from '../../_lib/db.js';
import { requireUser } from '../../_lib/auth.js';
import { allowMethods, withErrors } from '../../_lib/http.js';
import { signStemsDownload } from '../../_lib/storage.js';
import { sanitizeTitle } from '../../_lib/stems.js';

const MODAL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Aplana las pistas reproducibles desde `sections[*].outputs` (storage keys crudas) a
 * `stems`/`voices`/`genderVoices` con signed URLs de descarga. El DAG nunca puebla las
 * columnas planas; la fuente de verdad son los outputs por sección. Solo se incluyen las
 * pistas ya producidas (valores no nulos), por lo que sirve igual para `done` y `partial`.
 *
 * Para gender, los outputs tienen estructura anidada:
 *   { chorus: { male: key, female: key }, aufr33: { male: key, female: key } }
 * Se preserva esa estructura en genderVoices con URLs firmadas.
 */
async function withSignedUrls(job) {
  // SEC-07: solo firmar keys que pertenezcan al propio job.
  // Keys con prefijo ajeno (inyectadas vía webhook comprometido) no deben generar signed URL.
  const prefix = `${job.user_id}/${job.id}/`;

  // Perf: este endpoint se hace polling durante el job — firmar en paralelo (Promise.all)
  // en vez de secuencial. El filtro de prefijo corre ANTES del Promise.all, así que las
  // keys ajenas siguen sin generar signed URL (mismo guard, ahora también más rápido).
  const sign = async (obj) => {
    const entries = await Promise.all(
      Object.entries(obj)
        .filter(([, v]) => typeof v === 'string' && v.startsWith(prefix))
        .map(async ([k, v]) => [k, await signStemsDownload(v)]),
    );
    return Object.fromEntries(entries);
  };

  // gender: outputs anidados { chorus: {male,female}, aufr33: {male,female} }
  const signNested = async (obj) => {
    const entries = await Promise.all(
      Object.entries(obj)
        .filter(([, tracks]) => tracks && typeof tracks === 'object')
        .map(async ([modelKey, tracks]) => [modelKey, await sign(tracks)]),
    );
    return Object.fromEntries(entries);
  };

  const sections = job.sections ?? {};
  const stems = sections.voiceInstrumental?.outputs ?? {};
  const voices = sections.leadBacking?.outputs ?? {};
  const genderOutputs = sections.gender?.outputs ?? {};

  // genderVoices solo se popula si el section está done (outputs son objetos anidados).
  // Si los outputs son el shape antiguo plano {male, female} (filas pre-fase4), sign() los maneja.
  const hasNestedGender =
    genderOutputs &&
    Object.values(genderOutputs).some((v) => v && typeof v === 'object' && !Array.isArray(v));

  // Las 3 ramas (stems, voices, gender) no dependen entre sí: se resuelven en paralelo.
  const [signedStems, signedVoices, genderVoices] = await Promise.all([
    sign(stems),
    sign(voices),
    hasNestedGender ? signNested(genderOutputs) : sign(genderOutputs),
  ]);

  return { ...job, stems: signedStems, voices: signedVoices, genderVoices };
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET', 'PATCH'])) return;
  const user = await requireUser(req);
  const { id } = req.query;

  // SEC-15: columnas explícitas (no SELECT *) — una columna sensible agregada
  // mañana no queda expuesta al cliente sin que se note en el diff.
  let rows = await sql`
    SELECT id, user_id, status, input_path, input_meta, stems, voices, predictions,
           error, created_at, updated_at, expires_at, sections, enabled_sections
    FROM stem_jobs WHERE id = ${id} AND user_id = ${user.id}
  `;
  if (rows.length === 0) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }
  let job = rows[0];

  // PATCH: editar el título mostrado (input_meta.title). No toca el path de Storage.
  if (req.method === 'PATCH') {
    const meta = job.input_meta ?? {};
    const cleanTitle = sanitizeTitle(req.body?.title, meta.filename);
    const updated = await sql`
      UPDATE stem_jobs
      SET input_meta = ${sql.json({ ...meta, title: cleanTitle })}
      WHERE id = ${job.id} AND user_id = ${user.id}
      RETURNING id, user_id, status, input_path, input_meta, stems, voices, predictions,
                error, created_at, updated_at, expires_at, sections, enabled_sections
    `;
    if (!updated[0]) {
      res.status(404).json({ error: 'Job no encontrado' });
      return;
    }
    res.status(200).json({ job: toClientJob(updated[0]) });
    return;
  }

  // Modal es fire-and-forget: si el job lleva >10 min en processing sin avanzar, marcar failed.
  if (job.status === 'processing') {
    const elapsed = Date.now() - new Date(job.updated_at).getTime();
    if (elapsed > MODAL_TIMEOUT_MS) {
      await sql`
        UPDATE stem_jobs SET status = 'failed',
          error = 'El procesamiento expiró. Intenta de nuevo (no consumió tu cuota).', updated_at = now()
        WHERE id = ${job.id} AND status = 'processing'
      `;
      rows = await sql`
        SELECT id, user_id, status, input_path, input_meta, stems, voices, predictions,
               error, created_at, updated_at, expires_at, sections, enabled_sections
        FROM stem_jobs WHERE id = ${id} AND user_id = ${user.id}
      `;
      job = rows[0];
    }
  }

  // SEC-15: DTO explícito — omite columnas internas que el cliente no consume.
  // `input_path` expone claves de Storage internas; `predictions` es interno del pipeline.
  // `input_meta` se CONSERVA: el front lo usa para mostrar el nombre del archivo.
  function toClientJob(j) {
    const rest = { ...j };
    delete rest.input_path;
    delete rest.predictions;
    return rest;
  }

  // `done` y `partial` exponen las pistas ya producidas (firmadas desde sections.outputs).
  const ready = job.status === 'done' || job.status === 'partial';
  const enriched = ready ? await withSignedUrls(job) : job;
  res.status(200).json({ job: toClientJob(enriched) });
});
