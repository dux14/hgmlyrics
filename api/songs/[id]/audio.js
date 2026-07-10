import sql from '../../_lib/db.js';
import { requireUser, requireAdmin } from '../../_lib/auth.js';
import { allowMethods, withErrors } from '../../_lib/http.js';
import {
  createSongAudioSignedPutUrl,
  signSongAudioDownload,
  deleteSongAudioObject,
} from '../../_lib/storage.js';
import { dispatchAlign } from '../../_lib/align.js';

// GET: audio completo + estado de timings para la vista inmersiva.
async function getAudio(_req, res, songId) {
  const [audio] = await sql`
    SELECT storage_key AS "storageKey", duration_sec AS "durationSec"
    FROM song_audio WHERE song_id = ${songId}
  `;
  if (!audio) {
    res.status(200).json({ audio: null, timings: null });
    return;
  }
  const [timings] = await sql`
    SELECT status, lines FROM song_line_timings WHERE song_id = ${songId}
  `;
  res.status(200).json({
    audio: { url: await signSongAudioDownload(audio.storageKey), durationSec: audio.durationSec },
    timings: timings ?? null,
  });
}

async function postAudio(req, res, songId) {
  await requireAdmin(req, sql);
  const { confirm = false, durationSec = null } = req.body ?? {};

  const songRows = await sql`SELECT id FROM songs WHERE id = ${songId}`;
  if (songRows.length === 0) {
    res.status(404).json({ error: 'Song not found' });
    return;
  }

  if (confirm) {
    // La subida directa a Storage ya ocurrió (PUT firmado del paso anterior);
    // esto solo confirma duracion y resetea/dispara el alignment (decision 5
    // del spec: automatico, sin paso manual extra del admin).
    const result = await sql`
      UPDATE song_audio SET duration_sec = ${durationSec} WHERE song_id = ${songId}
    `;
    // Si no hubo fila song_audio (confirm fuera de orden o DELETE concurrente),
    // cortamos ANTES de tocar song_line_timings/dispatchAlign (mismo patrón que
    // api/songs/[id].js:97/114 y api/social/friends.js:78/96).
    if (result.count === 0) {
      res.status(404).json({ error: 'Audio no encontrado' });
      return;
    }
    await sql`
      INSERT INTO song_line_timings (song_id, status, lines, error)
      VALUES (${songId}, 'pending', NULL, NULL)
      ON CONFLICT (song_id)
      DO UPDATE SET status = 'pending', lines = NULL, error = NULL
    `;
    await dispatchAlign(songId);
    res.status(200).json({ success: true });
    return;
  }

  // La key SIEMPRE se construye server-side (nunca se acepta la del cliente).
  const key = `${songId}/full.mp3`;

  await sql`
    INSERT INTO song_audio (song_id, storage_key)
    VALUES (${songId}, ${key})
    ON CONFLICT (song_id)
    DO UPDATE SET storage_key = excluded.storage_key
  `;

  const uploadUrl = await createSongAudioSignedPutUrl(key);
  res.status(200).json({ uploadUrl, key });
}

async function deleteAudio(req, res, songId) {
  await requireAdmin(req, sql);

  const rows =
    await sql`SELECT storage_key AS "storageKey" FROM song_audio WHERE song_id = ${songId}`;
  if (rows.length === 0) {
    res.status(404).json({ error: 'Audio no encontrado' });
    return;
  }

  // Storage primero: si el remove falla, se corta antes de borrar filas y no
  // queda huerfano silencioso (el DELETE lanza 500 vía withErrors y el admin
  // puede reintentar; si borráramos las filas primero y el remove fallara, el
  // mp3 quedaría huérfano en el bucket sin ninguna fila que lo referencie).
  await deleteSongAudioObject(rows[0].storageKey);
  await sql`DELETE FROM song_audio WHERE song_id = ${songId}`;
  await sql`DELETE FROM song_line_timings WHERE song_id = ${songId}`;

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
    return getAudio(req, res, songId);
  }
  if (req.method === 'POST') return postAudio(req, res, songId);
  return deleteAudio(req, res, songId);
});
