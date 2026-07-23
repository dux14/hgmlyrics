/**
 * lyricsStore.js — acceso a song_pipeline_lyrics (letra IA-independiente del
 * pipeline, spec 2026-07-23). Los helpers reciben el cliente postgres.js
 * (sql o tx) como primer argumento: approveGate los usa dentro de su
 * transacción y los tests inyectan un fake. Sin lógica de dominio acá.
 */

/**
 * Upsert de la letra aprobada del pipeline (una fila por canción).
 * @param {Function} sql cliente postgres.js (sql o tx)
 * @param {{songId:string, runId:string|null, sections:Array, hash:string}} args
 */
export function upsertPipelineLyrics(sql, { songId, runId, sections, hash }) {
  return sql`
    INSERT INTO song_pipeline_lyrics (song_id, run_id, sections, hash, approved_at)
    VALUES (${songId}, ${runId}, ${sql.json(sections)}, ${hash}, now())
    ON CONFLICT (song_id) DO UPDATE
      SET run_id = EXCLUDED.run_id, sections = EXCLUDED.sections,
        hash = EXCLUDED.hash, approved_at = EXCLUDED.approved_at
  `;
}

/**
 * Letra aprobada del pipeline para una canción, o null si no hay.
 * @param {Function} sql cliente postgres.js
 * @param {string} songId
 * @returns {Promise<{songId:string, runId:string|null, sections:Array, hash:string, approvedAt:string}|null>}
 */
export async function getPipelineLyrics(sql, songId) {
  const rows = await sql`
    SELECT song_id AS "songId", run_id AS "runId", sections, hash,
      approved_at AS "approvedAt"
    FROM song_pipeline_lyrics WHERE song_id = ${songId}
  `;
  return rows[0] ?? null;
}
