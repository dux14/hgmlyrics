/**
 * Re-indexado de song_section_audio cuando el editor mueve/reordena secciones.
 * `song_section_audio` está keyed por section_index numérico (unique por
 * song_id+section_index+voice_scope, ver api/songs/[id]/section-audio.js), así
 * que mover/borrar secciones en el editor sin re-indexar deja el audio
 * apuntando a la sección equivocada. El PUT de api/songs/[id].js manda estos
 * moves calculados por el front (origIndex de cada bloque vs. su posición
 * final) y los aplica DENTRO de la misma transacción que el UPDATE de songs.
 */

/**
 * Valida un array de moves {from,to} contra la cantidad de secciones nueva.
 * @param {Array<{from:number,to:number}>} moves
 * @param {number} sectionCount
 * @returns {string|null} mensaje de error, o null si es válido
 */
export function validateSectionAudioMoves(moves, sectionCount) {
  if (!Array.isArray(moves)) return 'sectionAudioMoves debe ser un array';

  const froms = new Set();
  const tos = new Set();
  for (const m of moves) {
    if (!m || !Number.isInteger(m.from) || !Number.isInteger(m.to)) {
      return 'sectionAudioMoves: from/to deben ser enteros';
    }
    if (m.from < 0 || m.to < 0) {
      return 'sectionAudioMoves: from/to no pueden ser negativos';
    }
    if (m.from >= sectionCount || m.to >= sectionCount) {
      return 'sectionAudioMoves: from/to fuera de rango';
    }
    if (froms.has(m.from)) return 'sectionAudioMoves: from duplicado';
    if (tos.has(m.to)) return 'sectionAudioMoves: to duplicado';
    froms.add(m.from);
    tos.add(m.to);
  }
  return null;
}

/**
 * Aplica los moves dentro de la transacción del caller (sql.begin ya abierto
 * en api/songs/[id].js). Dos fases para no chocar con el unique constraint
 * (song_id, section_index, voice_scope) mientras los índices se reacomodan:
 * fase 1 lleva cada `from` a un índice temporal negativo único (-1-to, nunca
 * choca con un section_index real que siempre es >= 0); fase 2 des-negativiza
 * todo lo que quedó negativo, dejando el índice `to` final.
 * @param {import('postgres').TransactionSql} tx
 * @param {string} songId
 * @param {Array<{from:number,to:number}>} moves
 */
export async function applySectionAudioMoves(tx, songId, moves) {
  for (const m of moves) {
    await tx`
      UPDATE song_section_audio SET section_index = ${-1 - m.to}
      WHERE song_id = ${songId} AND section_index = ${m.from}
    `;
  }
  await tx`
    UPDATE song_section_audio SET section_index = -1 - section_index
    WHERE song_id = ${songId} AND section_index < 0
  `;
}
