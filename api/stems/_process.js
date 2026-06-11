/**
 * _process.js — Avance del pipeline cuando una sección del DAG termina.
 * El pipeline v1 (separación de voces por modelo externo) fue eliminado en Task 0.7.
 */
import { SECTION_KEYS, applySectionResult, deriveJobStatus } from './_sections.js';

/**
 * Aplica el resultado de una sección al job en una transacción con row-lock (FOR UPDATE).
 * Serializa escrituras concurrentes: Modal puede postear las 4 secciones simultáneamente.
 *
 * @param {import('postgres').Sql} sql
 * @param {string} jobId
 * @param {string} section - clave de SECTION_KEYS
 * @param {{ status:'done'|'failed', model?:string, outputs?:object, segments?:any[], error?:string }} result
 * @returns {Promise<{ status:string, sections:object }|null>} null si el job no existe
 */
export async function applySectionWebhook(sql, jobId, section, result) {
  if (!SECTION_KEYS.includes(section)) {
    const e = new Error(`Sección desconocida: ${section}`);
    e.status = 400;
    throw e;
  }

  return sql.begin(async (sql) => {
    // FOR UPDATE serializa las escrituras concurrentes de las 4 secciones del DAG.
    // Sin este lock, dos webhooks simultáneos podrían leer el mismo `sections` y
    // uno pisaría el resultado del otro (last-write-wins).
    const [job] = await sql`
      SELECT sections, status FROM stem_jobs WHERE id = ${jobId} FOR UPDATE
    `;
    if (!job) return null; // job desconocido

    const nextSections = applySectionResult(job.sections, section, result);
    const nextStatus = deriveJobStatus(nextSections);

    if (result.status === 'failed') {
      await sql`
        UPDATE stem_jobs
        SET sections = ${sql.json(nextSections)},
            status = ${nextStatus},
            error = ${result.error ?? 'section failed'},
            updated_at = now()
        WHERE id = ${jobId}
      `;
    } else {
      await sql`
        UPDATE stem_jobs
        SET sections = ${sql.json(nextSections)},
            status = ${nextStatus},
            updated_at = now()
        WHERE id = ${jobId}
      `;
    }

    return { status: nextStatus, sections: nextSections };
  });
}
