// Editor admin simple de la estructura detectada del audio (Task 15d, gate
// de letra). PATCH retipa el `label` de UN segmento de `song_structure.segments`
// y/o ajusta sus bordes (startMs/endMs) -- solo metadata de rango, NUNCA
// toca la letra en si (ver lyricsReview.js: los segmentos solo aportan
// rangos, el tipo/orden de sección de la letra manda).
import sql from '../../_lib/db.js';
import { requireAdmin } from '../../_lib/auth.js';
import { allowMethods, withErrors } from '../../_lib/http.js';

// 8-class EXACTO de SongFormer, normalizado a ES (ver _LABEL_MAP de
// modal/sections/songformer.py:57-68): intro, verse, chorus, bridge, inst,
// outro, silence, pre-chorus -> intro, verso, coro, puente, instrumental,
// outro, silencio, pre-coro. No inventar otras etiquetas.
const SONGFORMER_LABELS = [
  'intro', 'verso', 'coro', 'puente', 'instrumental', 'outro', 'silencio', 'pre-coro',
];

/**
 * Valida el body del PATCH (label y/o bordes de un segmento) contra el
 * segmento existente y sus vecinos. Solape/orden roto entre segmentos
 * vecinos se RECHAZA (interpretación mas segura: segmentos de SongFormer
 * son contiguos por construcción, ver song_structure.segments).
 * @param {{segmentIndex?: number, label?: string, startMs?: number, endMs?: number}} body
 * @param {Array<{label:string, startMs:number, endMs:number}>} segments
 * @returns {string|null} error o null.
 */
export function validateStructurePatch(body, segments) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body inválido';
  const { segmentIndex, label, startMs, endMs } = body;
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= segments.length) {
    return `segmentIndex fuera de rango: ${segmentIndex}`;
  }
  if (label === undefined && startMs === undefined && endMs === undefined) {
    return 'sin campos para actualizar';
  }
  if (label !== undefined && !SONGFORMER_LABELS.includes(label)) {
    return `label inválido: ${label}`;
  }

  const current = segments[segmentIndex];
  const nextStartMs = startMs === undefined ? current.startMs : startMs;
  const nextEndMs = endMs === undefined ? current.endMs : endMs;
  if (startMs !== undefined && (!Number.isFinite(startMs) || startMs < 0)) {
    return `startMs inválido: ${startMs}`;
  }
  if (endMs !== undefined && !Number.isFinite(endMs)) {
    return `endMs inválido: ${endMs}`;
  }
  if (nextStartMs >= nextEndMs) {
    return `startMs (${nextStartMs}) debe ser menor que endMs (${nextEndMs})`;
  }

  const prev = segments[segmentIndex - 1];
  if (prev && nextStartMs < prev.endMs) {
    return 'startMs se solapa con el segmento anterior';
  }
  const next = segments[segmentIndex + 1];
  if (next && nextEndMs > next.startMs) {
    return 'endMs se solapa con el segmento siguiente';
  }
  return null;
}

async function patchStructure(req, res, songId) {
  await requireAdmin(req, sql);

  // Lost-update fix (code review formal): SELECT + validacion + UPDATE en una
  // sola tx con FOR UPDATE, mismo patron CAS que retry.js/lyrics.js. Sin esto,
  // dos PATCH concurrentes sobre la misma cancion (aunque editen segmentos
  // distintos) se pisaban -- el segundo UPDATE sobreescribia el array entero
  // con su snapshot viejo, perdiendo la edicion del primero en silencio.
  const result = await sql.begin(async (tx) => {
    const [row] = await tx`SELECT segments FROM song_structure WHERE song_id = ${songId} FOR UPDATE`;
    if (!row) {
      return { status: 404, error: 'Estructura no encontrada' };
    }
    const segments = Array.isArray(row.segments) ? row.segments : [];

    const err = validateStructurePatch(req.body ?? null, segments);
    if (err) {
      return { status: 400, error: err };
    }

    const { segmentIndex, label, startMs, endMs } = req.body;
    const nextSegments = segments.map((seg, i) => (i === segmentIndex
      ? {
          ...seg,
          ...(label !== undefined ? { label } : {}),
          ...(startMs !== undefined ? { startMs } : {}),
          ...(endMs !== undefined ? { endMs } : {}),
        }
      : seg));

    await tx`
      UPDATE song_structure SET segments = ${tx.json(nextSegments)}, updated_at = now()
      WHERE song_id = ${songId}
    `;
    return { ok: true, segments: nextSegments };
  });

  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(200).json({ segments: result.segments });
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['PATCH'])) return;
  const songId = req.query.id;
  if (!songId || typeof songId !== 'string') {
    res.status(400).json({ error: 'id es obligatorio' });
    return;
  }
  return patchStructure(req, res, songId);
});
