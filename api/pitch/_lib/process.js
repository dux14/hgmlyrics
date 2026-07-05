/**
 * process.js — Aplica el webhook de una fase al job con compare-and-swap sobre
 * `phases` (evita TOCTOU entre callbacks concurrentes). Marca succeeded/partial
 * cuando todas las fases requeridas reportaron.
 */
export const REQUIRED_PHASES = ['separation', 'f0', 'notes', 'lyrics', 'fusion', 'render'];
const MAX_CAS_RETRIES = 5;
const RESULT_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * @param {import('postgres').Sql} sql
 * @param {string} jobId
 * @param {string} phase
 * @param {{ok?:boolean, error?:string, artifacts?:any[], cost?:number}} result
 * @returns {Promise<{status:string}|null>} null si el job no existe.
 */
export async function applyPhaseWebhook(sql, jobId, phase, result) {
  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
    const rows = await sql`SELECT id, status, phases, artifacts FROM pitch_jobs WHERE id = ${jobId}`;
    if (rows.length === 0) return null;
    const job = rows[0];
    // Estados terminales no aceptan más webhooks.
    if (['succeeded', 'failed', 'cancelled', 'expired'].includes(job.status)) {
      return { status: job.status };
    }
    const prevPhases = job.phases ?? {};
    const nextPhases = {
      ...prevPhases,
      [phase]: { status: result?.ok === false ? 'failed' : 'done', error: result?.error ?? null, cost: result?.cost ?? null },
    };
    const nextArtifacts = [...(job.artifacts ?? []), ...(Array.isArray(result?.artifacts) ? result.artifacts : [])];

    // CAS: solo actualiza si phases sigue igual a lo que leímos.
    const upd = await sql`
      UPDATE pitch_jobs
      SET phases = ${sql.json(nextPhases)}, artifacts = ${sql.json(nextArtifacts)}, updated_at = now()
      WHERE id = ${jobId} AND phases = ${sql.json(prevPhases)}
    `;
    if (upd.count !== 1) continue; // otra escritura ganó; releer y reintentar.

    // ¿Terminó todo? Calcular estado final.
    const done = REQUIRED_PHASES.filter((p) => nextPhases[p]?.status === 'done').length;
    const failed = REQUIRED_PHASES.filter((p) => nextPhases[p]?.status === 'failed').length;
    const reported = done + failed;
    if (reported >= REQUIRED_PHASES.length) {
      const finalStatus = failed === 0 ? 'succeeded' : done === 0 ? 'failed' : 'partial';
      // Resultados descargables (succeeded y partial) obtienen TTL de 48h para que el cron los limpie.
      const extra = (finalStatus === 'succeeded' || finalStatus === 'partial')
        ? sql`, expires_at = ${new Date(Date.now() + RESULT_TTL_MS)}`
        : sql``;
      await sql`UPDATE pitch_jobs SET status = ${finalStatus}, updated_at = now() ${extra} WHERE id = ${jobId}`;
      return { status: finalStatus };
    }
    return { status: job.status };
  }
  // Se agotaron los reintentos de CAS: reportar el estado actual sin fallar el webhook.
  const rows = await sql`SELECT status FROM pitch_jobs WHERE id = ${jobId}`;
  return rows.length ? { status: rows[0].status } : null;
}
