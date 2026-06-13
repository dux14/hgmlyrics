import sql from '../../_lib/db.js';
import { requireUser } from '../../_lib/auth.js';
import { allowMethods, withErrors } from '../../_lib/http.js';
import { signStemsDownload } from '../../_lib/storage.js';

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
  const sign = async (obj) => {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v.includes('/')) out[k] = await signStemsDownload(v);
    }
    return out;
  };

  // gender: outputs anidados { chorus: {male,female}, aufr33: {male,female} }
  const signNested = async (obj) => {
    const out = {};
    for (const [modelKey, tracks] of Object.entries(obj)) {
      if (tracks && typeof tracks === 'object') {
        out[modelKey] = await sign(tracks);
      }
    }
    return out;
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

  const genderVoices = hasNestedGender
    ? await signNested(genderOutputs)
    : await sign(genderOutputs);

  return { ...job, stems: await sign(stems), voices: await sign(voices), genderVoices };
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET'])) return;
  const user = await requireUser(req);
  const { id } = req.query;

  let rows = await sql`SELECT * FROM stem_jobs WHERE id = ${id} AND user_id = ${user.id}`;
  if (rows.length === 0) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }
  let job = rows[0];

  // Modal es fire-and-forget: si el job lleva >10 min en processing sin avanzar, marcar failed.
  if (job.status === 'processing') {
    const elapsed = Date.now() - new Date(job.updated_at).getTime();
    if (elapsed > MODAL_TIMEOUT_MS) {
      await sql`
        UPDATE stem_jobs SET status = 'failed',
          error = 'El procesamiento expiró. Intenta de nuevo (no consumió tu cuota).', updated_at = now()
        WHERE id = ${job.id} AND status = 'processing'
      `;
      rows = await sql`SELECT * FROM stem_jobs WHERE id = ${id} AND user_id = ${user.id}`;
      job = rows[0];
    }
  }

  // `done` y `partial` exponen las pistas ya producidas (firmadas desde sections.outputs).
  const ready = job.status === 'done' || job.status === 'partial';
  res.status(200).json({ job: ready ? await withSignedUrls(job) : job });
});
