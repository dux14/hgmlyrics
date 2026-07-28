/**
 * Re-indexado de song_section_audio cuando el editor mueve/reordena secciones.
 * `song_section_audio` está keyed por section_index numérico (unique por
 * song_id+section_index+voice_scope, ver api/songs/[id]/section-audio.js), así
 * que mover/borrar secciones en el editor sin re-indexar deja el audio
 * apuntando a la sección equivocada. El PUT de api/songs/[id].js manda estos
 * moves calculados por el front (origIndex de cada bloque vs. su posición
 * final) y los aplica DENTRO de la misma transacción que el UPDATE de songs.
 */

// Offset de desambiguación para la fase temporal de applySectionAudioMoves.
// El schema real tiene `CHECK (section_index >= 0)` (ver migración
// 20260707120000_song_section_audio.sql) — un índice temporal NEGATIVO viola
// ese CHECK en cuanto el UPDATE toca una fila real (justo el caso central de
// esta feature: una sección CON audio que se mueve), tirando la transacción
// entera con un 500. El offset es POSITIVO y muy por encima de cualquier
// section_index real, así que nunca viola el CHECK ni choca con filas no
// tocadas por los moves (esas siempre son < MOVE_OFFSET).
const MOVE_OFFSET = 1_000_000;

/**
 * Valida un array de moves {from,to}. `from` referencia el layout VIEJO de
 * secciones (antes del guardado) y por eso NO se acota contra `sectionCount`
 * (el nuevo layout, que puede ser más chico si se borraron secciones en el
 * medio) — el UPDATE de applySectionAudioMoves ya es seguro si `from` no
 * matchea ninguna fila (WHERE section_index = from). `to` sí referencia el
 * layout NUEVO, así que se acota: to < sectionCount. Además `to` se rechaza
 * si invade la zona reservada para el offset temporal (MOVE_OFFSET/10, muy
 * por encima de cualquier cantidad real de secciones) — cinturón adicional
 * para que un body patológico no pueda chocar con la fase temporal.
 * @param {Array<{from:number,to:number}>} moves
 * @param {number} sectionCount tamaño del layout NUEVO (post-guardado)
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
    if (m.to >= sectionCount || m.to >= 100_000) {
      return 'sectionAudioMoves: to fuera de rango';
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
 * fase 1 lleva cada `from` a un índice temporal MOVE_OFFSET+to (los `to`
 * únicos garantizan temporales únicos entre sí, y el offset los deja muy por
 * encima de cualquier section_index real no tocado, así que tampoco chocan
 * con esas filas); fase 2 resta el offset de todo lo que quedó por encima,
 * dejando el índice `to` final. El offset es positivo (nunca negativo) a
 * propósito: el schema tiene CHECK (section_index >= 0), así que una fase
 * temporal negativa viola el CHECK en cuanto toca una fila real.
 * Fase 1 es un único UPDATE con `unnest` de dos arrays (from/to+offset) en vez
 * de un UPDATE por move: es el único loop de SQL secuencial del repo (hallazgo
 * de auditoría), y el editor puede mandar tantos moves como secciones tenga
 * la canción. `unnest` sobre dos arrays paralelos es la forma estándar de
 * Postgres de expresar un `UPDATE ... FROM (VALUES ...)` sin construir el
 * VALUES a mano fila por fila.
 * @param {import('postgres').TransactionSql} tx
 * @param {string} songId
 * @param {Array<{from:number,to:number}>} moves
 */
export async function applySectionAudioMoves(tx, songId, moves) {
  if (moves.length > 0) {
    const froms = moves.map((m) => m.from);
    const temps = moves.map((m) => MOVE_OFFSET + m.to);
    await tx`
      UPDATE song_section_audio AS sa
      SET section_index = u.temp_idx
      FROM unnest(${froms}::int[], ${temps}::int[]) AS u(from_idx, temp_idx)
      WHERE sa.song_id = ${songId} AND sa.section_index = u.from_idx
    `;
  }
  await tx`
    UPDATE song_section_audio SET section_index = section_index - ${MOVE_OFFSET}
    WHERE song_id = ${songId} AND section_index >= ${MOVE_OFFSET}
  `;
}
