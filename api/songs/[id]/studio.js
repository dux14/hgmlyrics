// GET público (requireUser, no admin) del Estudio de una canción: stems
// publicados con URL firmada, análisis de partitura vocal, secciones/título
// de la canción y estado del alignment (karaoke). 404 = todavía no hay stems
// publicados, así el chip del front sabe que no existe estudio para mostrar.
import sql from '../../_lib/db.js';
import { requireUser } from '../../_lib/auth.js';
import { allowMethods, withErrors } from '../../_lib/http.js';
import { signSongAudioDownload } from '../../_lib/storage.js';

async function getStudio(_req, res, songId) {
  const [stems, [pitch], [song], [timings]] = await Promise.all([
    sql`
      SELECT kind, storage_key AS "storageKey", duration_sec AS "durationSec", display
      FROM song_stems WHERE song_id = ${songId}
    `,
    sql`SELECT analysis FROM song_pitch_analysis WHERE song_id = ${songId}`,
    sql`SELECT sections, title FROM songs WHERE id = ${songId}`,
    sql`SELECT status, lines FROM song_line_timings WHERE song_id = ${songId}`,
  ]);

  if (stems.length === 0) {
    res.status(404).json({ error: 'Esta canción todavía no tiene estudio publicado' });
    return;
  }

  const signedStems = await Promise.all(
    stems.map(async (s) => ({
      kind: s.kind,
      url: await signSongAudioDownload(s.storageKey),
      display: s.display ?? null,
      // NUMERIC llega como string vía postgres.js: coacción explícita.
      durationSec: s.durationSec == null ? null : Number(s.durationSec),
    })),
  );

  res.status(200).json({
    stems: signedStems,
    analysis: pitch?.analysis ?? null,
    sections: song?.sections ?? [],
    timings: timings ? { status: timings.status, lines: timings.lines } : null,
    title: song?.title ?? null,
  });
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET'])) return;
  const songId = req.query.id;
  if (!songId || typeof songId !== 'string') {
    res.status(400).json({ error: 'id is required' });
    return;
  }
  await requireUser(req);
  return getStudio(req, res, songId);
});
