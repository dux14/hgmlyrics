// GET (requireUser) de las sílabas con nota de una canción, para la acción
// «traer el tono de la IA» del editor del cancionero. Existe aparte de
// /api/songs/[id]/studio porque ese endpoint responde 404 sin stems publicados
// y firma stems + clips en batch (hasta ~200 keys de Storage) en la misma
// llamada: inservible para el editor. Proyector delgado, sin lógica de notas —
// el nombre de las sílabas repetidas (ditto) lo deriva el front, que es quien
// tiene el texto en pantalla contra el que hay que mapear.
import sql from '../../_lib/db.js';
import { requireUser } from '../../_lib/auth.js';
import { allowMethods, withErrors } from '../../_lib/http.js';

const EMPTY = { hasAnalysis: false, voicesPresent: [], voices: {} };

/**
 * Proyecta el `analysis` crudo a la forma que consume el editor: solo las voces
 * con letra (`lines`) y solo los campos que el mapeo necesita. `ditto`, `blank`
 * y `score` no viajan: los dos primeros son derivables (`blank` = midi nulo,
 * `ditto` = note nulo con midi presente) y el tercero no tiene consumidor.
 */
function projectAnalysis(analysis) {
  const rawVoices = analysis?.voices ?? {};
  const voices = {};
  for (const [key, entry] of Object.entries(rawVoices)) {
    if (!Array.isArray(entry?.lines)) continue;
    voices[key] = {
      lines: entry.lines.map((line, i) => ({
        i,
        syllables: (Array.isArray(line?.syllables) ? line.syllables : []).map((s) => ({
          text: s.text ?? '',
          start: s.start ?? null,
          end: s.end ?? null,
          midi: s.midi ?? null,
          note: s.note ?? null,
          cents: s.cents ?? null,
        })),
      })),
    };
  }

  const present = Array.isArray(analysis?.voices_present) ? analysis.voices_present : [];
  // Orden canónico del análisis, acotado a las voces que quedaron.
  const voicesPresent = present.filter((k) => voices[k]);
  for (const key of Object.keys(voices)) {
    if (!voicesPresent.includes(key)) voicesPresent.push(key);
  }

  return { hasAnalysis: true, voicesPresent, voices };
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET'])) return;
  const songId = req.query.id;
  if (!songId || typeof songId !== 'string') {
    res.status(400).json({ error: 'id is required' });
    return;
  }
  await requireUser(req);

  const [row] = await sql`SELECT analysis FROM song_pitch_analysis WHERE song_id = ${songId}`;
  if (!row?.analysis) {
    res.status(200).json(EMPTY);
    return;
  }
  res.status(200).json(projectAnalysis(row.analysis));
});
