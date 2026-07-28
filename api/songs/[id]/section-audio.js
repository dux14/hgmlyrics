import sql from '../../_lib/db.js';
import { requireUser, requireAdmin } from '../../_lib/auth.js';
import { allowMethods, withErrors } from '../../_lib/http.js';
import {
  createSongAudioSignedPutUrl,
  signSongAudioDownloads,
  deleteSongAudioObject,
} from '../../_lib/storage.js';

// Espeja CANONICAL_VOICE_ORDER (voiceSystem.js) + lead/backing del Estudio
// (stems leadBacking): son las categorías que puede traer un audio de sección.
const VOICE_SCOPES = ['soprano', 'contralto', 'tenor', 'bass', 'lead', 'backing'];

async function getSectionAudio(_req, res, songId) {
  const rows = await sql`
    SELECT id, section_index AS "sectionIndex", voice_scope AS "voiceScope",
           storage_key AS "storageKey", label, duration_sec::float8 AS "durationSec"
    FROM song_section_audio
    WHERE song_id = ${songId}
    ORDER BY section_index, voice_scope
  `;
  // Firma en batch (1 request a Storage) en vez de un createSignedUrl por
  // clip: con muchas secciones × scopes la ráfaga tropezaba con el rate limit
  // de Supabase (429).
  const urls = await signSongAudioDownloads(rows.map((r) => r.storageKey));
  const items = rows.map(({ storageKey, ...row }, idx) => ({ ...row, url: urls[idx] }));
  res.status(200).json({ items });
}

async function postSectionAudio(req, res, songId) {
  await requireAdmin(req, sql);
  const { sectionIndex, voiceScope = null, label = null, durationSec = null } = req.body ?? {};

  if (!Number.isInteger(sectionIndex) || sectionIndex < 0) {
    res.status(400).json({ error: 'sectionIndex inválido' });
    return;
  }
  if (voiceScope !== null && !VOICE_SCOPES.includes(voiceScope)) {
    res.status(400).json({ error: 'voiceScope inválido' });
    return;
  }

  const songRows = await sql`SELECT sections FROM songs WHERE id = ${songId}`;
  if (songRows.length === 0) {
    res.status(404).json({ error: 'Song not found' });
    return;
  }
  const sections = songRows[0].sections ?? [];
  if (sectionIndex >= sections.length) {
    res.status(400).json({ error: 'sectionIndex fuera de rango' });
    return;
  }

  // La key SIEMPRE se construye server-side (nunca se acepta la del cliente).
  const key = `${songId}/section-${sectionIndex}${voiceScope ? `-${voiceScope}` : ''}.mp3`;

  const rows = await sql`
    INSERT INTO song_section_audio (song_id, section_index, voice_scope, storage_key, label, duration_sec)
    VALUES (${songId}, ${sectionIndex}, ${voiceScope}, ${key}, ${label}, ${durationSec})
    ON CONFLICT (song_id, section_index, coalesce(voice_scope, ''))
    DO UPDATE SET storage_key = excluded.storage_key,
                  label = excluded.label,
                  duration_sec = excluded.duration_sec
    RETURNING id
  `;

  const uploadUrl = await createSongAudioSignedPutUrl(key);
  res.status(200).json({ uploadUrl, key, id: rows[0].id });
}

async function deleteSectionAudio(req, res, songId) {
  await requireAdmin(req, sql);
  const { id } = req.body ?? {};
  if (!id || typeof id !== 'string') {
    res.status(400).json({ error: 'id es requerido' });
    return;
  }

  const rows =
    await sql`SELECT storage_key AS "storageKey" FROM song_section_audio WHERE id = ${id} AND song_id = ${songId}`;
  if (rows.length === 0) {
    res.status(404).json({ error: 'Audio no encontrado' });
    return;
  }

  // Storage primero: si el remove falla, se corta antes de borrar la fila y no
  // queda huérfano silencioso (el DELETE lanza 500 vía withErrors y el admin puede
  // reintentar; si borráramos la fila primero y el remove fallara, el mp3 quedaría
  // huérfano en el bucket sin ninguna fila que lo referencie).
  await deleteSongAudioObject(rows[0].storageKey);
  await sql`DELETE FROM song_section_audio WHERE id = ${id} AND song_id = ${songId}`;

  res.status(200).json({ success: true });
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET', 'POST', 'DELETE'])) return;
  const songId = req.query.id;
  if (!songId || typeof songId !== 'string') {
    res.status(400).json({ error: 'id is required' });
    return;
  }
  if (req.method === 'GET') {
    await requireUser(req);
    return getSectionAudio(req, res, songId);
  }
  if (req.method === 'POST') return postSectionAudio(req, res, songId);
  return deleteSectionAudio(req, res, songId);
});
